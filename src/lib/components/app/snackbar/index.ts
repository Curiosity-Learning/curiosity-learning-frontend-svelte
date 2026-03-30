import { toast } from 'svelte-sonner';
import SnackbarToast from './snackbar-toast.svelte';

type GlobalSnackbarOptions = {
	title: string;
	description?: string;
	duration?: number;
};

export const showGlobalSnackbar = ({
	title,
	description,
	duration = 3200
}: GlobalSnackbarOptions) => {
	return toast.custom(SnackbarToast, {
		componentProps: {
			title,
			description
		},
		duration,
		position: 'bottom-left',
		closeButton: false,
		class: '!border-0 !bg-transparent !p-0 !shadow-none'
	});
};
