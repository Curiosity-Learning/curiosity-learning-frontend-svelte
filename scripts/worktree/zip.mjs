// Minimal zip read/write for Convex snapshot exports, so data copying does not depend on the
// zip/unzip binaries (Vercel's build image is not guaranteed to have them). Node 22.2+ (zlib.crc32).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Extract every file entry into `destDir`. Reads the central directory, so entries written with
// data descriptors (sizes after the data) are handled.
export function unzipTo(zipFile, destDir) {
	const buf = fs.readFileSync(zipFile);
	let eocd = buf.length - 22;
	while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
	if (eocd < 0) throw new Error(`${zipFile} is not a zip file`);
	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16);
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
		const method = buf.readUInt16LE(p + 10);
		let compSize = buf.readUInt32LE(p + 20);
		let rawSize = buf.readUInt32LE(p + 24);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		let localOffset = buf.readUInt32LE(p + 42);
		const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
		// Zip64 (Convex exports use it): 0xFFFFFFFF fields live in extra field 0x0001, in order.
		const MAX = 0xffffffff;
		for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
			const id = buf.readUInt16LE(e);
			const size = buf.readUInt16LE(e + 2);
			if (id === 0x0001) {
				let q = e + 4;
				if (rawSize === MAX) {
					rawSize = Number(buf.readBigUInt64LE(q));
					q += 8;
				}
				if (compSize === MAX) {
					compSize = Number(buf.readBigUInt64LE(q));
					q += 8;
				}
				if (localOffset === MAX) localOffset = Number(buf.readBigUInt64LE(q));
			}
			e += 4 + size;
		}
		p += 46 + nameLen + extraLen + commentLen;

		const out = path.resolve(destDir, name);
		if (!out.startsWith(path.resolve(destDir) + path.sep))
			throw new Error(`Unsafe zip entry ${name}`);
		if (name.endsWith('/')) {
			fs.mkdirSync(out, { recursive: true });
			continue;
		}
		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + localNameLen + localExtraLen;
		const data = buf.subarray(start, start + compSize);
		fs.mkdirSync(path.dirname(out), { recursive: true });
		if (method === 0) fs.writeFileSync(out, data);
		else if (method === 8) fs.writeFileSync(out, zlib.inflateRawSync(data));
		else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
	}
}

// Zip every file under `srcDir` (deflated), paths relative to it with forward slashes.
export function zipDir(srcDir, zipFile) {
	const files = [];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else files.push(full);
		}
	};
	walk(srcDir);

	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const full of files) {
		const name = Buffer.from(path.relative(srcDir, full).split(path.sep).join('/'));
		const raw = fs.readFileSync(full);
		const comp = zlib.deflateRawSync(raw);
		const crc = zlib.crc32(raw);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(comp.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, comp);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(comp.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + comp.length;
	}
	const centralSize = centrals.reduce((n, b) => n + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	fs.writeFileSync(zipFile, Buffer.concat([...locals, ...centrals, end]));
}
