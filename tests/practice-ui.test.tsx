import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from "react-test-renderer";
import "fake-indexeddb/auto";
import { StudioProvider } from "../src/components/studio-provider";
import { PracticeAnalysisProvider } from "../src/components/practice-analysis-provider";
import { PracticeLevels } from "../src/components/practice-experience";
import { PracticeMentor } from "../src/components/practice-mentor";
import { PracticeAnalysisSession } from "../src/lib/practice-session";
import { generatePracticeFeedback } from "../src/lib/practice-feedback";
import type { createFeedbackClient } from "../src/lib/practice-feedback-client";
import { experimentalFixture } from "./helpers/experimental-fixture";
import { practiceFixture } from "./helpers/practice-fixture";

function contents(node: ReactTestInstance): string {
  return node.children
    .map((c) => (typeof c === "string" ? c : contents(c)))
    .join(" ");
}
function button(node: ReactTestInstance, label: string) {
  return node.findAllByType("button").find((b) => contents(b).includes(label))!;
}

test("pitch mentor distinguishes insufficient, neutral and notable outcomes when the selected interval changes", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldAct = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const fixture = practiceFixture();
  fixture.pitch.frames.forEach((f) => {
    f.cents = f.time < 3 ? 2 : 15;
    if (f.time >= 3 && f.time < 5) f.diagnostics!.margin = 0.01;
  });
  let calls = 0;
  const session = new PracticeAnalysisSession(
    fixture.recordingId,
    async (_id, _file, _signal, _progress, experimental) => {
      calls++;
      return experimental
        ? { ...fixture, experimental: experimentalFixture(fixture) }
        : fixture;
    },
  );
  const feedbackFactory: typeof createFeedbackClient = (analysis) => ({
    request: async (input) => generatePracticeFeedback({ ...input, analysis }),
    dispose() {},
  });
  let rendered: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      rendered = create(
        <StudioProvider>
          <PracticeAnalysisProvider
            recording={{
              id: fixture.recordingId,
              name: "Cello.wav",
              file: new Blob(["audio"]),
              size: 5,
              addedAt: 0,
              instrument: "cello",
            }}
            session={session}
            feedbackFactory={feedbackFactory}
          >
            <PracticeMentor />
          </PracticeAnalysisProvider>
        </StudioProvider>,
      );
    });
    const root = rendered!.root;
    await act(async () => {
      root.findByType("select").props.onChange({ target: { value: "pitch" } });
    });
    await act(async () => {
      button(root, "Analyse for my goal").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const changeBoundary = async (label: string, value: number) => {
      await act(async () =>
        root
          .findAllByType("label")
          .find((n) => contents(n).includes(label))!
          .findByType("input")
          .props.onChange({ target: { valueAsNumber: value } }),
      );
    };
    await changeBoundary("End (seconds)", 2);
    let notice = root.findByProps({
      "data-pitch-outcome": "no-qualifying-pattern",
    });
    assert.match(contents(notice), /measured|Measured/);
    assert.match(contents(notice), /sustained same-note region/);
    assert.doesNotMatch(contents(root), /Not enough reliable information/);
    assert.equal(
      root.findAllByProps({ className: "mentor-finding" }).length,
      0,
    );
    await changeBoundary("End (seconds)", 4.5);
    await changeBoundary("Start (seconds)", 3.2);
    notice = root.findByProps({
      "data-pitch-outcome": "insufficient-evidence",
    });
    assert.match(contents(notice), /candidate margin ≥ 0.06/);
    assert.equal(notice.findByType("details").props.open, true);
    await changeBoundary("End (seconds)", 7);
    await changeBoundary("Start (seconds)", 5.2);
    root.findByProps({ "data-pitch-outcome": "notable-pattern" });
    const finding = root.findAllByProps({ className: "mentor-finding" })[0];
    assert.match(contents(finding), /nearest equal-tempered reference/);
    assert.ok(button(finding, "Listen"));
    assert.match(contents(finding), /Try this/);
    assert.equal(calls, 1, "interval changes reuse existing DSP measurements");
    await act(async () =>
      root
        .findByType("select")
        .props.onChange({ target: { value: "dynamics" } }),
    );
    assert.equal(
      root.findAll((n) => !!n.props["data-pitch-outcome"]).length,
      0,
    );
  } finally {
    if (rendered) await act(async () => rendered!.unmount());
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldAct)
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

test("student hierarchy keeps graphs outside Advanced and simple review synchronises with advanced editing", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldAct = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      matchMedia: () => ({
        matches: true,
        addListener() {},
        removeListener() {},
      }),
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  let rendered: ReactTestRenderer | undefined;
  let calls = 0;
  const fixture = practiceFixture();
  const feedbackFactory: typeof createFeedbackClient = (analysis) => ({
    request: async (input) => generatePracticeFeedback({ ...input, analysis }),
    dispose() {},
  });
  const session = new PracticeAnalysisSession(
    fixture.recordingId,
    async (_id, _file, _signal, _progress, experimental) => {
      calls++;
      return experimental
        ? { ...fixture, experimental: experimentalFixture(fixture) }
        : fixture;
    },
  );
  const recording = {
    id: fixture.recordingId,
    name: "Test cello.wav",
    file: new Blob(["audio"]),
    size: 5,
    addedAt: 0,
    instrument: "cello" as const,
  };
  try {
    await act(async () => {
      rendered = create(
        <StudioProvider>
          <PracticeAnalysisProvider
            recording={recording}
            session={session}
            feedbackFactory={feedbackFactory}
          >
            <PracticeLevels>
              <div>Existing player slot</div>
            </PracticeLevels>
          </PracticeAnalysisProvider>
        </StudioProvider>,
      );
    });
    const root = rendered!.root;
    await act(async () => {
      button(root, "Analyse for my goal").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(calls, 1);
    const explore = root.findByProps({ className: "performance-level" });
    for (const title of [
      "Detected pitch trajectory",
      "Deviation from nearest semitone",
      "Dynamic contour",
      "Spectral brightness",
      "Level stability over time",
    ])
      assert.ok(contents(explore).includes(title), title);
    assert.ok(!contents(explore).includes("Noise-related & change indicators"));
    assert.ok(!contents(explore).includes("Competing pitch candidates"));
    const advanced = root.findByProps({ className: "panel advanced-level" });
    assert.ok(!contents(advanced).includes("Review articulation candidates"));
    const goal = root
      .findAllByType("select")
      .find((s) => s.props.value === "dynamics")!;
    await act(async () =>
      goal.props.onChange({ target: { value: "transitions" } }),
    );
    assert.equal(calls, 1, "changing goal must not repeat DSP");
    await act(async () => button(root, "Yes").props.onClick());
    assert.match(contents(root), /You identified a bow reversal/);
    await act(async () =>
      advanced.props.onToggle({ currentTarget: { open: true } }),
    );
    assert.ok(contents(advanced).includes("Noise-related & change indicators"));
    assert.ok(contents(advanced).includes("Review articulation candidates"));
    const mode = root.findByProps({ "aria-label": "Pitch analysis mode" });
    assert.equal(mode.props.value, "standard");
    await act(async () =>
      mode.props.onChange({ target: { value: "experimental" } }),
    );
    assert.match(contents(advanced), /not validated for musical accuracy/);
    assert.match(contents(advanced), /No experimental comparison/);
    assert.equal(
      calls,
      1,
      "mode view selection does not duplicate DSP or decoding",
    );
    assert.match(contents(explore), /Detected pitch trajectory/);
    await act(async () =>
      mode.props.onChange({ target: { value: "standard" } }),
    );
    let firstEvent = root.findAllByProps({ className: "tone-event" })[0];
    assert.match(contents(firstEvent), /bow change: yes/);
    await act(async () => button(root, "Not sure").props.onClick());
    firstEvent = root.findAllByProps({ className: "tone-event" })[0];
    assert.match(contents(firstEvent), /Your review: unsure/);
    assert.doesNotMatch(
      contents(root.findAllByProps({ className: "mentor-finding" })[0]),
      /You identified a bow reversal/,
    );
    await act(async () => button(root, "No").props.onClick());
    firstEvent = root.findAllByProps({ className: "tone-event" })[0];
    assert.match(contents(firstEvent), /Your review: not-bow/);
    const timeInput = firstEvent.findByType("input");
    const interpretation = firstEvent.findByType("select");
    await act(async () => {
      timeInput.props.onChange({ target: { value: "2.8" } });
      interpretation.props.onChange({
        target: { value: "candidate-bow-reversal" },
      });
    });
    await act(async () =>
      button(firstEvent, "Save adjustment").props.onClick(),
    );
    firstEvent = root.findAllByProps({ className: "tone-event" })[0];
    assert.match(contents(firstEvent), /Your review: adjusted/);
    assert.match(contents(root), /original acoustic candidate at 2.00/);
    assert.match(contents(root), /2.80 seconds/);
    assert.equal(calls, 1, "reviewing and comparing must not repeat DSP");
    await act(async () => button(root, "Useful").props.onClick());
    assert.equal(button(root, "Useful").props["aria-pressed"], true);
    const finding = root.findAllByProps({ className: "mentor-finding" })[0];
    const before = contents(finding);
    await act(async () =>
      button(finding, "Another supported investigation").props.onClick(),
    );
    assert.notEqual(contents(finding), before);
    await act(async () =>
      mode.props.onChange({ target: { value: "experimental" } }),
    );
    await act(async () => {
      button(advanced, "Analyse again").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(calls, 2);
    const updatedAdvanced = root.findByProps({
      className: "panel advanced-level",
    });
    assert.match(contents(updatedAdvanced), /experimental additional work/);
    assert.match(
      contents(root.findByProps({ className: "performance-level" })),
      /Detected pitch trajectory/,
    );
    assert.match(
      contents(updatedAdvanced),
      /Practice Mentor, Explore and tone analysis still use Standard/,
    );
    await act(async () =>
      root
        .findByProps({ "aria-label": "Pitch analysis mode" })
        .props.onChange({ target: { value: "standard" } }),
    );
    assert.equal(calls, 2);
    // Every input/select has an associated label, including both diagnostic views.
    const controls = root.findAll(
      (n) => n.type === "input" || n.type === "select",
    );
    for (const control of controls) {
      const labelled =
        control.props["aria-label"] ||
        control.props["aria-labelledby"] ||
        control.parent?.type === "label" ||
        root
          .findAllByType("label")
          .some((l) => l.props.htmlFor && l.props.htmlFor === control.props.id);
      assert.ok(labelled, `Unlabelled ${String(control.type)}`);
    }
    const ids = root
      .findAll((n) => typeof n.type === "string" && !!n.props.id)
      .map((n) => n.props.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      "IDs must be unique across Explore and Advanced",
    );
  } finally {
    if (rendered) await act(async () => rendered!.unmount());
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldAct)
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

test("recording switches reset mentor state without remounting existing microphone or player controls", async () => {
  const { default: Practice } = await import("../src/app/practice/page");
  const { MicrophoneRecorder } =
    await import("../src/components/microphone-recorder");
  const { Player } = await import("../src/components/player");
  const { useStudio } = await import("../src/components/studio-provider");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldAct = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  let select!: ReturnType<typeof useStudio>["select"];
  function Probe() {
    select = useStudio().select;
    return null;
  }
  let rendered: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      rendered = create(
        <StudioProvider>
          <Probe />
          <Practice />
        </StudioProvider>,
      );
    });
    const mic = rendered!.root.findByType(MicrophoneRecorder),
      player = rendered!.root.findByType(Player);
    const goal = rendered!.root
      .findAllByType("select")
      .find((s) => s.props.value === "dynamics")!;
    await act(async () =>
      goal.props.onChange({ target: { value: "expression" } }),
    );
    await act(async () =>
      select({
        id: "switched-recording",
        name: "Other cello.wav",
        file: new Blob(["audio"]),
        size: 5,
        addedAt: 1,
        instrument: "cello",
      }),
    );
    assert.equal(rendered!.root.findByType(MicrophoneRecorder), mic);
    assert.equal(rendered!.root.findByType(Player), player);
    assert.ok(
      rendered!.root
        .findAllByType("select")
        .some((s) => s.props.value === "dynamics"),
    );
    assert.match(
      contents(rendered!.root),
      /Your observations will appear here after analysis/,
    );
  } finally {
    if (rendered) await act(async () => rendered!.unmount());
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldAct)
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
