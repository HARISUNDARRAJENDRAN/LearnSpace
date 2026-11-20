import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Features } from "../components/marketing/Features";
import { Hero } from "../components/marketing/Hero";
import { LearningLoop } from "../components/marketing/LearningLoop";

test("renders the LearnSpace landing hero", () => {
	const markup = renderToStaticMarkup(<Hero />);

	assert.match(markup, /AI-native learning workspace/);
	assert.doesNotMatch(markup, /ls-demo-toolbar/);
	assert.match(markup, /Learn anything on the internet,/);
	assert.match(markup, /without the internet’s distractions\./);
	assert.match(markup, /Start learning/);
	assert.match(markup, /href="\/register"/);
	assert.match(markup, /Log in/);
	assert.match(markup, /aria-label="LearnSpace product demo"/);
	assert.match(markup, /src="\/media\/learnspace-intro\.mp4"/);
	assert.match(markup, /LearnSpace home/);
});

test("authenticated hero points learners back to the app", () => {
	const markup = renderToStaticMarkup(<Hero authenticated />);

	assert.match(markup, /Open LearnSpace/);
	assert.match(markup, /href="\/app"/);
	assert.doesNotMatch(markup, /Log in|href="\/register"/);
});

test("features render as tabs with only the first panel open", () => {
	const markup = renderToStaticMarkup(<Features />);

	// Panels hold slices of the real app, which carry their own tabs, so count the feature tabs by id.
	assert.equal(markup.match(/role="tab"[^>]*id="[a-z]+-tab"|id="[a-z]+-tab"[^>]*role="tab"/g)?.length, 5);
	assert.equal(markup.match(/id="[a-z]+-tab"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="[a-z]+-tab"/g)?.length, 1);
	assert.match(markup, /id="discovery-tab"[^>]*aria-selected="true"/);
	assert.equal(markup.match(/role="tabpanel"[^>]*hidden=""/g)?.length, 4);
});

test("learning loop starts on the first of nine steps", () => {
	const markup = renderToStaticMarkup(<LearningLoop />);

	assert.equal(markup.match(/class="ls-loop-node[ "]/g)?.length, 9);
	assert.match(markup, /Step 01 of 09/);
	assert.match(markup, /aria-current="step"[^>]*><span class="ls-loop-num">01/);
});
