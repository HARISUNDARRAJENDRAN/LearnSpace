export type FeatureConcept = "context" | "research" | "tutor" | "practice" | "mastery" | "discovery";

function ContextScene() {
	return (
		<>
			<rect x="-24" y="60" width="408" height="132" fill="#fafff8" fillOpacity=".74" stroke="#7eac9b" strokeWidth="1.5" />
			<path d="M72 60v132m102-132v132m100-132v132" stroke="#c9dfd0" strokeWidth="1.5" />
			<path d="M-20 171h400" stroke="#397f7d" strokeWidth="6" />
			<path d="M-20 171h400" stroke="#e3f4d8" strokeWidth="2" strokeDasharray="1 15" />
			<g fill="#397f7d" stroke="#fafff8" strokeWidth="3">
				<circle cx="32" cy="171" r="7" />
				<circle cx="123" cy="171" r="7" />
				<circle cx="223" cy="171" r="7" />
				<circle cx="323" cy="171" r="7" />
			</g>
			<g fill="#47756d" fontSize="10" fontWeight="600" letterSpacing="1">
				<text x="16" y="83">WATCH</text>
				<text x="91" y="83">READ</text>
				<text x="193" y="83">NOTE</text>
				<text x="291" y="83">TRY</text>
			</g>
			<g stroke="#397f7d" strokeWidth="2" strokeLinejoin="round">
				<rect x="-11" y="102" width="49" height="38" rx="3" fill="#d9efcf" />
				<path d="m8 113 17 9-17 9Z" fill="#397f7d" stroke="none" />
				<path d="M89 104h50v39H89Zm9 9h31m-31 8h38m-38 8h27" fill="#e6f2fb" />
				<path d="M193 105h51v39h-51Zm9 10h31m-31 8h23m-23 8h33" fill="#fff" />
				<path d="M295 104h55v40h-55Zm11 11h22m-22 9h31m-31 9h17m22 2 6 6 11-13" fill="#d8efcd" />
			</g>
			<g fill="#397f7d" fontSize="9" fontWeight="600" letterSpacing=".8">
				<text x="16" y="213">VIDEO</text>
				<text x="102" y="213">PAPER</text>
				<text x="203" y="213">NOTES</text>
				<text x="305" y="213">PRACTICE</text>
			</g>
		</>
	);
}

function ResearchScene() {
	return (
		<>
			<g transform="rotate(-3 205 130)">
				<rect x="34" y="-28" width="354" height="318" fill="#fff" stroke="#b4cbd6" strokeWidth="1.5" />
				<path d="M34 48h354" stroke="#dce9ee" strokeWidth="1.5" />
				<text x="57" y="27" fill="#6d8793" fontSize="9" fontWeight="600" letterSpacing="1.2">ARXIV · 1706.03762</text>
				<text x="57" y="76" fill="#20495c" fontSize="17" fontWeight="600">Attention Is All You Need</text>
				<text x="57" y="94" fill="#8ba0aa" fontSize="10">Vaswani · Shazeer · Parmar · 2017</text>
				<path d="M57 113h278m-278 9h252m-252 9h269" stroke="#d7e4e8" strokeWidth="2" />
				<rect x="48" y="150" width="292" height="61" fill="#dff1d2" />
				<path d="M63 169h263" stroke="#8fbe78" strokeWidth="1" />
				<text x="73" y="192" fill="#246276" fontSize="20" fontFamily="serif">Attention(Q,K,V) = softmax(QKᵀ/√dₖ)V</text>
				<path d="M57 231h278m-278 9h252m-252 9h192m-192 9h222" stroke="#d7e4e8" strokeWidth="2" />
			</g>
			<path d="M21 224h58l31-37" stroke="#397f7d" strokeWidth="1.5" />
			<text x="21" y="243" fill="#397f7d" fontSize="10" fontWeight="600" letterSpacing=".6">§ 3.2 · attention score</text>
		</>
	);
}

function TutorScene() {
	return (
		<>
			<g transform="rotate(1 180 130)">
				<rect x="-24" y="27" width="408" height="218" fill="#fff" stroke="#b7ceda" strokeWidth="1.5" />
				<path d="M-24 58h408" stroke="#dce9ee" strokeWidth="1.5" />
				<g fill="#a6c8d6">
					<circle cx="-6" cy="43" r="3" />
					<circle cx="6" cy="43" r="3" />
					<circle cx="18" cy="43" r="3" />
				</g>
				<text x="42" y="47" fill="#7c969f" fontSize="10" letterSpacing="1">LESSON 04 / SCREEN 12</text>
				<path d="M24 87h117m-117 12h86m-86 12h131m-131 12h63" stroke="#d1e1e6" strokeWidth="3" />
				<path d="M198 82h137m-137 12h101m-101 12h118m-118 12h76" stroke="#d1e1e6" strokeWidth="3" />
				<path d="M24 202h166m-166 12h124" stroke="#d1e1e6" strokeWidth="3" />
			</g>
			<path d="M18 190c45-7 69-3 101 1 34 4 69-3 98-1 32 2 57 9 95 0" stroke="#176c82" strokeWidth="6" strokeOpacity=".88" />
		</>
	);
}

function PracticeScene() {
	return (
		<>
			<rect x="-18" y="47" width="396" height="166" fill="#fbfff9" stroke="#a6c8ae" strokeWidth="1.5" />
			<path d="M111 47v166m126-166v166" stroke="#d3e4d0" strokeWidth="1.5" />
			<g fill="#44755d" fontSize="10" fontWeight="600" letterSpacing="1.2">
				<text x="17" y="70">01 / LESSON</text>
				<text x="131" y="70">02 / ATTEMPT</text>
				<text x="257" y="70">03 / CONTINUE</text>
			</g>
			<g stroke="#44755d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M22 119c16-10 32-10 48 0v42c-16-10-32-10-48 0Z" fill="#d8efce" />
				<path d="M46 119v42" />
				<path d="M140 154h67m-67-13h48m-48-13h56" />
				<path d="m148 171 9 8 17-20" stroke="#86b978" strokeWidth="4" />
				<path d="M273 104v69m0 0h43m-43 0-13-13m13 13 13-13" />
			</g>
			<path d="M25 192h298" stroke="#b9d7b5" strokeWidth="5" />
			<path d="M25 192h90m35 0h92m35 0h46" stroke="#5c9b67" strokeWidth="5" />
		</>
	);
}

function MasteryScene() {
	return (
		<>
			<g stroke="#5e9a87" strokeWidth="1.5" strokeOpacity=".72">
				<path d="M39 93 117 67l72 47 74-59 70 36" />
				<path d="M39 93 85 184l104-70 39 88 35-147" />
				<path d="M117 67 145 207m44-93 74 30m0 0 70-53" />
			</g>
			<g strokeWidth="1.5" strokeLinejoin="round">
				<path d="m93 50 24-10 25 12-5 25-27 8-21-15Z" fill="#c8e5f1" stroke="#4d879b" />
				<text x="103" y="62" fill="#326b7e" fontSize="10" fontWeight="600">vectors</text>
				<path d="m170 92 20-13 26 10 3 26-23 14-25-11Z" fill="#17677b" stroke="#17677b" />
				<text x="178" y="105" fill="#fff" fontSize="10" fontWeight="600">memory</text>
				<path d="m259 35 25-6 22 16-8 24-27 3-17-18Z" fill="#d7efcf" stroke="#6da16e" />
				<text x="266" y="51" fill="#47795a" fontSize="10" fontWeight="600">proofs</text>
				<path d="m62 166 25-13 25 14-3 28-27 8-22-17Z" fill="#fff" stroke="#8bb3bf" />
				<text x="70" y="182" fill="#5e7c87" fontSize="10" fontWeight="600">examples</text>
				<path d="m215 184 27-13 26 15-6 29-29 5-22-17Z" fill="#f4f8f5" stroke="#4f7e82" strokeDasharray="4 3" />
				<text x="221" y="201" fill="#4f7e82" fontSize="10" fontWeight="600">attention</text>
			</g>
			<path d="M277 225h52" stroke="#4f7e82" strokeWidth="1.5" />
			<text x="277" y="242" fill="#4f7e82" fontSize="10" fontWeight="600" letterSpacing=".7">REVISIT</text>
		</>
	);
}

function DiscoveryScene() {
	return (
		<>
			<g transform="rotate(-5 -4 139)">
				<rect x="-42" y="29" width="166" height="226" fill="#176579" stroke="#0f5365" strokeWidth="1.5" />
				<path d="M-42 72h166M-42 78h166" stroke="#74b5bd" strokeWidth="3" />
				<path d="m-20 127 89-48 54 32v55l-99 47-44-27Z" fill="#25839a" />
				<path d="M-15 207h83m-83 13h101" stroke="#bde5dc" strokeWidth="2" />
				<text x="-21" y="57" fill="#d9f1ed" fontSize="10" fontWeight="600" letterSpacing="1.2">FIELD NOTES / 08</text>
			</g>
			<g transform="rotate(3 180 126)">
				<rect x="99" y="22" width="164" height="206" fill="#fff" stroke="#a8c7d0" strokeWidth="1.5" />
				<rect x="114" y="43" width="134" height="64" fill="#d9efcf" />
				<path d="M127 91 158 61l20 17 24-27 38 42" fill="#afd28f" />
				<path d="M115 130h125m-125 11h103m-103 11h120m-120 11h84" stroke="#d5e3e8" strokeWidth="2" />
				<text x="115" y="194" fill="#296b76" fontSize="11" fontWeight="600" letterSpacing=".8">A VISUAL GUIDE</text>
				<text x="115" y="211" fill="#7b969d" fontSize="9">12 min · starts here</text>
			</g>
			<g transform="rotate(9 329 103)">
				<rect x="271" y="30" width="117" height="150" fill="#c9e6f4" stroke="#6f9fb4" strokeWidth="1.5" />
				<path d="M288 54h79m-79 10h61m-61 10h72" stroke="#78a9ba" strokeWidth="2" />
				<rect x="288" y="96" width="72" height="40" fill="#f8fffa" />
				<path d="m312 108 20 12-20 12Z" fill="#4d879b" />
				<text x="288" y="159" fill="#397387" fontSize="9" fontWeight="600">LECTURE 12</text>
			</g>
			<g fill="#326d78" fontSize="10" fontWeight="600" letterSpacing=".5">
				<text x="18" y="249">fills a gap</text>
				<text x="145" y="247">continues this session</text>
				<text x="284" y="196">fits your level</text>
			</g>
		</>
	);
}

const scenes = { context: ContextScene, research: ResearchScene, tutor: TutorScene, practice: PracticeScene, mastery: MasteryScene, discovery: DiscoveryScene };

export function FeatureIllustration({ concept }: { concept: FeatureConcept }) {
	const Scene = scenes[concept];
	return (
		<svg className={`feature-illustration feature-illustration-${concept}`} viewBox="0 0 360 260" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			<Scene />
		</svg>
	);
}
