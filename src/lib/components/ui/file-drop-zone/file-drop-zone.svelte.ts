import type { ReadableBoxedValues } from 'svelte-toolbelt';
import type { FileRejectedReason } from './types';
import { Context } from 'runed';
import type { HTMLAttributes } from 'svelte/elements';
import { toast } from 'svelte-sonner';
import { displaySize } from './index';

type FileDropZoneStateOptions = ReadableBoxedValues<{
	id: string;
	disabled: boolean;
	onUpload: (files: File[]) => Promise<void>;
	maxFiles: number | undefined;
	fileCount: number | undefined;
	maxFileSize: number | undefined;
	onFileRejected: ((opts: { reason: FileRejectedReason; file: File }) => void) | undefined;
	showErrorToasts: boolean;
	accept: string | undefined;
}>;

class FileDropZoneState {
	uploading = $state(false);
	dragDepth = $state(0);

	constructor(readonly opts: FileDropZoneStateOptions) {
		if (this.opts.maxFiles !== undefined && this.opts.fileCount === undefined) {
			console.warn(
				'Make sure to provide FileDropZone with `fileCount` when using the `maxFiles` prompt'
			);
		}

		this.onchange = this.onchange.bind(this);
		this.ondrop = this.ondrop.bind(this);
	}

	async ondrop(
		e: DragEvent & {
			currentTarget: EventTarget;
		}
	) {
		if (this.opts.disabled.current || !this.canUploadFiles) return;

		e.preventDefault();
		this.dragDepth = 0;

		const droppedFiles = Array.from(e.dataTransfer?.files ?? []);

		await this.upload(droppedFiles);
	}

	async onchange(
		e: Event & {
			currentTarget: EventTarget & HTMLInputElement;
		}
	) {
		if (this.opts.disabled.current) return;

		const selectedFiles = e.currentTarget.files;

		if (!selectedFiles) return;

		await this.upload(Array.from(selectedFiles));

		// this if a file fails and we upload the same file again we still get feedback
		(e.target as HTMLInputElement).value = '';
	}

	ondragenter(e: DragEvent) {
		if (this.opts.disabled.current || !this.canUploadFiles) return;
		e.preventDefault();
		this.dragDepth += 1;
	}

	ondragover(e: DragEvent) {
		if (this.opts.disabled.current || !this.canUploadFiles) return;
		e.preventDefault();
	}

	ondragleave(e: DragEvent) {
		if (this.opts.disabled.current) return;
		e.preventDefault();
		this.dragDepth = Math.max(0, this.dragDepth - 1);
	}

	shouldAcceptFile(file: File): FileRejectedReason | undefined {
		if (this.opts.maxFileSize.current !== undefined && file.size > this.opts.maxFileSize.current)
			return 'Maximum file size exceeded';

		if (!this.opts.accept.current) return undefined;

		const acceptedTypes = this.opts.accept.current.split(',').map((a) => a.trim().toLowerCase());
		const fileType = file.type.toLowerCase();
		const fileName = file.name.toLowerCase();

		const isAcceptable = acceptedTypes.some((pattern) => {
			// check extension like .mp4
			if (fileType === '' || pattern.startsWith('.')) {
				return fileName.endsWith(pattern);
			}

			// if pattern has wild card like video/*
			if (pattern.endsWith('/*')) {
				const baseType = pattern.slice(0, pattern.indexOf('/*'));
				return fileType.startsWith(baseType + '/');
			}

			// otherwise it must be a specific type like video/mp4
			return fileType === pattern;
		});

		if (!isAcceptable) return 'File type not allowed';

		return undefined;
	}

	reportRejections = (rejections: Array<{ file: File; reason: FileRejectedReason }>) => {
		if (!rejections.length) {
			return;
		}

		for (const rejection of rejections) {
			this.opts.onFileRejected.current?.(rejection);
		}

		if (!this.opts.showErrorToasts.current) {
			return;
		}

		// Group by rejection reason so feature code gets one sensible default toast instead
		// of a burst of per-file errors. Callers that want custom inline handling can opt
		// out with `showErrorToasts={false}` and rely on `onFileRejected` instead.
		const byReason = new Map<FileRejectedReason, number>();
		for (const rejection of rejections) {
			byReason.set(rejection.reason, (byReason.get(rejection.reason) ?? 0) + 1);
		}

		for (const [reason, count] of byReason) {
			if (reason === 'Maximum files uploaded') {
				const maxFiles = this.opts.maxFiles.current;
				toast.error(
					maxFiles
						? `You can upload up to ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`
						: 'Too many files selected.'
				);
				continue;
			}

			if (reason === 'Maximum file size exceeded') {
				const maxFileSize = this.opts.maxFileSize.current;
				toast.error(
					maxFileSize
						? `${count} file${count === 1 ? '' : 's'} exceed the ${displaySize(maxFileSize)} limit.`
						: `${count} file${count === 1 ? '' : 's'} exceed the maximum file size.`
				);
				continue;
			}

			toast.error(
				count === 1 ? 'That file type is not allowed.' : `${count} files have unsupported types.`
			);
		}
	};

	upload = async (uploadFiles: File[]) => {
		this.uploading = true;

		const existingFileCount = this.opts.fileCount?.current ?? 0;
		if (
			this.opts.maxFiles.current !== undefined &&
			existingFileCount + uploadFiles.length > this.opts.maxFiles.current
		) {
			// Reject the whole attempted batch when it would exceed the configured limit.
			// This keeps selection behavior predictable for multi-file pickers instead of
			// silently accepting the first few files and dropping the rest.
			this.reportRejections(
				uploadFiles.map((file) => ({ file, reason: 'Maximum files uploaded' as const }))
			);
			this.uploading = false;
			return;
		}

		const validFiles: File[] = [];
		const rejections: Array<{ file: File; reason: FileRejectedReason }> = [];

		for (let i = 0; i < uploadFiles.length; i++) {
			const file = uploadFiles[i];

			const rejectedReason = this.shouldAcceptFile(file);

			if (rejectedReason) {
				rejections.push({ file, reason: rejectedReason });
				continue;
			}

			validFiles.push(file);
		}

		this.reportRejections(rejections);

		if (validFiles.length) {
			await this.opts.onUpload.current?.(validFiles);
		}

		this.uploading = false;
	};

	canUploadFiles = $derived.by(() => {
		if (this.opts.disabled.current) return false;
		if (this.uploading) return false;
		if (
			this.opts.maxFiles.current !== undefined &&
			this.opts.fileCount.current !== undefined &&
			this.opts.fileCount.current >= this.opts.maxFiles.current
		)
			return false;
		return true;
	});

	isDragActive = $derived.by(() => this.canUploadFiles && this.dragDepth > 0);

	props = $derived.by(() => ({
		disabled: !this.canUploadFiles,
		id: this.opts.id.current,
		accept: this.opts.accept.current,
		multiple:
			this.opts.maxFiles.current === undefined ||
			this.opts.maxFiles.current - (this.opts.fileCount.current ?? 0) > 1,
		type: 'file',
		onchange: this.onchange
	}));
}

class FileDropZoneTrigger {
	constructor(readonly rootState: FileDropZoneState) {}

	ondrop(
		e: DragEvent & {
			currentTarget: EventTarget & HTMLLabelElement;
		}
	) {
		this.rootState.ondrop(e);
	}

	props = $derived.by(() => ({
		ondragenter: this.rootState.ondragenter.bind(this.rootState),
		ondragover: this.rootState.ondragover.bind(this.rootState),
		ondragleave: this.rootState.ondragleave.bind(this.rootState),
		ondrop: this.ondrop.bind(this),
		for: this.rootState.opts.id.current,
		'aria-disabled': !this.rootState.canUploadFiles,
		'data-drag-active': this.rootState.isDragActive ? 'true' : 'false'
	}));
}

type FileDropZoneTextareaOptions = ReadableBoxedValues<{
	ondragenter: HTMLAttributes<HTMLTextAreaElement>['ondragenter'];
	ondragover: HTMLAttributes<HTMLTextAreaElement>['ondragover'];
	ondragleave: HTMLAttributes<HTMLTextAreaElement>['ondragleave'];
	ondrop: HTMLAttributes<HTMLTextAreaElement>['ondrop'];
	onpaste: HTMLAttributes<HTMLTextAreaElement>['onpaste'];
}>;

class FileDropZoneTextareaState {
	constructor(
		readonly opts: FileDropZoneTextareaOptions,
		readonly rootState: FileDropZoneState
	) {}

	ondragenter(e: Parameters<NonNullable<HTMLAttributes<HTMLTextAreaElement>['ondragenter']>>[0]) {
		this.rootState.ondragenter(e);
		this.opts.ondragenter.current?.(e);
	}

	ondragover(e: Parameters<NonNullable<HTMLAttributes<HTMLTextAreaElement>['ondragover']>>[0]) {
		this.rootState.ondragover(e);
		this.opts.ondragover.current?.(e);
	}

	ondragleave(e: Parameters<NonNullable<HTMLAttributes<HTMLTextAreaElement>['ondragleave']>>[0]) {
		this.rootState.ondragleave(e);
		this.opts.ondragleave.current?.(e);
	}

	ondrop(e: Parameters<NonNullable<HTMLAttributes<HTMLTextAreaElement>['ondrop']>>[0]) {
		this.rootState.ondrop(e);
		this.opts.ondrop.current?.(e);
	}

	onpaste(e: Parameters<NonNullable<HTMLAttributes<HTMLTextAreaElement>['onpaste']>>[0]) {
		const clipboardData = e.clipboardData;
		if (!clipboardData) {
			this.opts.onpaste.current?.(e);
			return;
		}

		const files = Array.from(clipboardData.items)
			.map((item) => item.getAsFile())
			.filter((file) => file !== null);

		this.rootState.upload(files);

		this.opts.onpaste.current?.(e);
	}

	props = $derived.by(() => ({
		ondragenter: this.ondragenter.bind(this),
		ondragover: this.ondragover.bind(this),
		ondragleave: this.ondragleave.bind(this),
		ondrop: this.ondrop.bind(this),
		onpaste: this.onpaste.bind(this)
	}));
}

const ctx = new Context<FileDropZoneState>('file-drop-zone-state');

export function useFileDropZone(opts: FileDropZoneStateOptions) {
	return ctx.set(new FileDropZoneState(opts));
}

export function useFileDropZoneTrigger() {
	return new FileDropZoneTrigger(ctx.get());
}

export function useFileDropZoneTextarea(opts: FileDropZoneTextareaOptions) {
	return new FileDropZoneTextareaState(opts, ctx.get());
}
