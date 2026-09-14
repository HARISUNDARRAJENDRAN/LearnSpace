import { getImageProps } from "next/image";

export function Landscape({ priority = false }: { priority?: boolean }) {
	const { props } = getImageProps({
		src: "/assets/marketing/alpine.webp",
		width: 3840,
		height: 1280,
		sizes:
			"(max-width: 720px) 1100px, (max-width: 1600px) calc(100vw - 48px), 1680px",
		alt: "",
	});
	return (
		<img
			{...props}
			alt=""
			className="scenic-mountains"
			loading={priority ? undefined : "lazy"}
			fetchPriority={priority ? "high" : "auto"}
		/>
	);
}
