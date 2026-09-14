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
  assert.match(markup, /Start learning/);
  assert.match(markup, /See how it works/);
  assert.doesNotMatch(markup, /Start Free Trial|Download for Playstore|\+100k active users/);
  assert.doesNotMatch(markup, /hero-tools|hero-tool/);
  assert.match(markup, /LearnSpace home/);
});

test("authenticated hero points learners back to the app", () => {
  const markup = renderToStaticMarkup(<Hero authenticated />);

  assert.match(markup, /Open LearnSpace/);
  assert.match(markup, /href="\/app"/);
  assert.doesNotMatch(markup, /Log in|href="\/register"/);
});
