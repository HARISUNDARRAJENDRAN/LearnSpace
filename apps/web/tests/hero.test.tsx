import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Hero } from "../components/marketing/hero/Hero";

test("renders the native LearnSpace learning hero", () => {
  const markup = renderToStaticMarkup(<Hero />);

	assert.match(markup, /AI-NATIVE LEARNING WORKSPACE/);
  assert.match(markup, /Learn anything\./);
  assert.match(markup, /Lose nothing\./);
  assert.match(markup, /Discover videos and papers/);
  assert.match(markup, /Download for Linux/);
  assert.match(markup, /See how it works/);
  assert.doesNotMatch(markup, /Start Free Trial|Download for Playstore|\+100k active users|href="\/(?:login|register|app)/);
  assert.doesNotMatch(markup, /hero-tools|hero-tool/);
  assert.match(markup, /LearnSpace home/);
});
