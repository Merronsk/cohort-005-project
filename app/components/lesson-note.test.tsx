import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { LessonNote, type LessonNoteData } from "./lesson-note";

function render(note: LessonNoteData) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <LessonNote note={note} /> },
  ]);
  return renderToString(<Stub initialEntries={["/"]} />);
}

function contentClassName(html: string) {
  const match = html.match(/data-slot="card-content"[^>]*class="([^"]*)"/);
  const reversed = html.match(/class="([^"]*)"[^>]*data-slot="card-content"/);
  const className = match?.[1] ?? reversed?.[1];
  if (className === undefined) throw new Error("no card content rendered");
  return className.split(" ");
}

describe("LessonNote", () => {
  it("shows the saved note and when it was last edited", () => {
    const html = render({
      body: "Types are erased at runtime",
      updatedAt: new Date().toISOString(),
    });

    expect(html).toContain("Your notes");
    expect(html).toContain("Types are erased at runtime");
    expect(html).toContain("Last edited");
  });

  it("shows an empty note with no edit time when nothing is saved", () => {
    const html = render(null);

    expect(html).toContain("Only you can read this.");
    expect(html).not.toContain("Last edited");
  });

  it("does not pad the top on top of the card's own padding", () => {
    const classes = contentClassName(render(null));

    expect(classes.some((c) => /^(pt|py|p)-/.test(c))).toBe(false);
  });
});
