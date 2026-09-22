"use client";

/**
 * What every canvas gesture does, as a reference list.
 *
 * Deliberately stateless and chrome-free: it is rendered inside the week
 * panel's "How to edit" tab and knows nothing about what is selected. The live
 * half — how many blocks are selected and what the next key will do to them —
 * lives on the page, in `CanvasSelectionChip`, because that changes as you work
 * and a drawer is the wrong place for anything that does.
 *
 * It exists at all because none of Alt-drag, the corner handle or a relative
 * paste is guessable from looking at a grid of coloured blocks. Without it
 * staff keep using the ⋯ menu and the whole canvas reads as decoration.
 */
export default function CanvasShortcutList() {
  return (
    <dl className="space-y-3 py-2">
      <Row term="Click a block">Selects it. Double-click opens its details.</Row>
      <Row term="Shift-click / Ctrl-click">
        Selects a range of lanes and times, or adds one block to the selection.
      </Row>
      <Row term="Drag a block">
        Moves it — new lane, new time. Drop it on a day chip to change the day.
      </Row>
      <Row term="Drag its top or bottom edge">Changes when it starts or ends.</Row>
      <Row term="Drag the square at its corner">Extends the same session across more lanes.</Row>
      <Row term="Alt-drag">
        Changes <strong className="text-foreground">this week only</strong>, leaving the rest of the
        series alone.
      </Row>
      <Row term="Ctrl-C / Ctrl-X, then Ctrl-V">
        Paste lands on the lane and time you last clicked, keeping the shape of what you copied.
      </Row>
      <Row term="Ctrl-D">Repeats each selected block directly below itself.</Row>
      <Row term="Delete">
        Removes the whole recurring series, not just the block you can see. Undo brings it back.
      </Row>
      <Row term="Arrow keys">
        Move the selection 15 minutes or one lane. Shift-Up/Down changes when it ends.
      </Row>
      <Row term="Tab, then Space or Enter">
        Reaches a block without a mouse — Space selects it, Enter opens its details.
      </Row>
      <Row term="Ctrl-Z / Ctrl-Shift-Z">Undo and redo. Every edit saves as you make it.</Row>
    </dl>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-foreground">{term}</dt>
      <dd className="text-sm text-muted-foreground leading-snug">{children}</dd>
    </div>
  );
}
