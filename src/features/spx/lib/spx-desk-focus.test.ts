import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusHotkeyAction,
  isTypingTarget,
  nextFocusState,
} from "./spx-desk-focus";

test("isTypingTarget: inputs / textareas / selects / contentEditable are typing surfaces", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "input" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "DIV" }), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});

test("focusHotkeyAction: F toggles (either case), ignored while typing", () => {
  assert.equal(focusHotkeyAction({ key: "f" }, { tagName: "BODY" }, false), "toggle");
  assert.equal(focusHotkeyAction({ key: "F" }, { tagName: "BODY" }, true), "toggle");
  assert.equal(focusHotkeyAction({ key: "f" }, { tagName: "INPUT" }, false), null);
  assert.equal(
    focusHotkeyAction({ key: "f" }, { tagName: "DIV", isContentEditable: true }, false),
    null
  );
});

test("focusHotkeyAction: modifier chords and key repeats never fire", () => {
  assert.equal(focusHotkeyAction({ key: "f", metaKey: true }, { tagName: "BODY" }, false), null);
  assert.equal(focusHotkeyAction({ key: "f", ctrlKey: true }, { tagName: "BODY" }, false), null);
  assert.equal(focusHotkeyAction({ key: "f", altKey: true }, { tagName: "BODY" }, false), null);
  assert.equal(focusHotkeyAction({ key: "f", repeat: true }, { tagName: "BODY" }, false), null);
});

test("focusHotkeyAction: Escape exits only while focus mode is active", () => {
  assert.equal(focusHotkeyAction({ key: "Escape" }, { tagName: "BODY" }, true), "exit");
  assert.equal(focusHotkeyAction({ key: "Escape" }, { tagName: "BODY" }, false), null);
  // Esc still exits even when the focused element is an input? No — typing guard wins,
  // the member is dismissing the input's own state, not the desk's.
  assert.equal(focusHotkeyAction({ key: "Escape" }, { tagName: "INPUT" }, true), null);
});

test("focusHotkeyAction: other keys do nothing", () => {
  assert.equal(focusHotkeyAction({ key: "g" }, { tagName: "BODY" }, true), null);
  assert.equal(focusHotkeyAction({ key: "Enter" }, { tagName: "BODY" }, true), null);
});

test("nextFocusState reducer", () => {
  assert.equal(nextFocusState(false, "toggle"), true);
  assert.equal(nextFocusState(true, "toggle"), false);
  assert.equal(nextFocusState(true, "exit"), false);
  assert.equal(nextFocusState(false, "exit"), false);
  assert.equal(nextFocusState(true, null), true);
});
