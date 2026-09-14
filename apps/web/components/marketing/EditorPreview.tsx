import { getImageProps } from "next/image";

const toolbarItems = ["⌁", "B", "◐", "≡"] as const;

export function EditorPreview() {
	const { props: landscapeProps } = getImageProps({
		src: "/assets/marketing/alpine.webp",
		width: 3840,
		height: 1280,
		sizes: "(max-width: 720px) calc(100vw - 32px), min(1180px, calc(100vw - 48px))",
		alt: "",
	});
	return (
		<figure className="editor-preview">
			<img
				{...landscapeProps}
				className="editor-landscape"
				loading="lazy"
				alt=""
			/>
			<div className="editor-window">
				<div className="editor-toolbar" role="toolbar" aria-label="Formatting toolbar">
					<button type="button" className="editor-style">
						Style 01
					</button>
					{toolbarItems.map((item) => (
						<button
							className="editor-toolbar-button"
							key={item}
							type="button"
							aria-label={`Formatting option ${item}`}
						>
							{item}
						</button>
					))}
					<span className="editor-toolbar-spacer" aria-hidden="true" />
					<button
						className="editor-color-button"
						type="button"
						aria-label="Choose text color"
					>
						<span aria-hidden="true" />
					</button>
					<button
						className="editor-toolbar-button editor-next-button"
						type="button"
						aria-label="More formatting options"
					>
						›
					</button>
				</div>
				<div className="editor-document">
					<p>
						Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam eu
						turpis molestie, dictum est a, mattis tellus. Sed dignissim, metus
						nec fringilla accumsan, risus sem sollicitudin lacus, ut interdum
						 tellus elit sed risus.
					</p>
					<p>
						Maecenas eget condimentum velit, sit amet feugiat lectus. Class
						aptent taciti sociosqu ad litora torquent per conubia nostra, per
						inceptos himenaeos. Praesent auctor purus luctus enim egestas ac.
						<span className="editor-highlight">Curabitur vel blanditorem.</span>
					</p>
					<p>
						Morbi convallis convallis diam sit amet lacinia. Aliquam in
						tellus euismod, consequat sem in, egestas magna.
					</p>
				</div>
				<div className="editor-actions">
					<button type="button" className="editor-summary-button">
						AI summary
					</button>
					<button type="button" className="editor-save-button">
						Save <span aria-hidden="true">●</span>
					</button>
				</div>
			</div>
			<figcaption className="sr-only">
				A browser-rendered note editor with formatting controls, highlighted
				text, and AI summary actions.
			</figcaption>
		</figure>
	);
}
