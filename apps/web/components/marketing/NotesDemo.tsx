import { EditorPreview } from "./EditorPreview";

export function NotesDemo() {
	return (
		<>
			<section
				className="intro-copy content-container"
				data-reveal="fade"
				id="how-it-works"
				aria-labelledby="notes-title"
			>
				<span className="intro-eyebrow">CAPTURE IN CONTEXT</span>
				<h2 id="notes-title">Capture the idea. Keep the context.</h2>
				<p>
					Notes, highlights, questions, and key moments stay connected to the video,
					paper, or study session they came from — so you can return without losing
					where the idea started.
				</p>
			</section>
			<div className="notes-demo content-container" data-reveal="scale" data-reveal-delay="100">
				<EditorPreview />
			</div>
		</>
	);
}
