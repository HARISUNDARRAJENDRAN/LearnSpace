import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Hero } from "../components/marketing/hero/Hero";

test("renders the LearnSpace hero content and local mark", () => {
  const markup = renderToStaticMarkup(<Hero />);

  assert.match(markup, /Your space to learn,/);
  assert.match(markup, /research, and remember\./);
  assert.match(markup, /Start Learning/);
  assert.match(markup, /assets\/learnspace-mark\.svg/);
});
