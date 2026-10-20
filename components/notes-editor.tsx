"use client";

import "@blocknote/mantine/style.css";
import { useEffect, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core";

export type NotesEditorHandle = {
  /** Replace the whole document without firing onChange (used when remote edits arrive). */
  replace: (doc: unknown[]) => void;
};

export function NotesEditor({
  initialContent,
  onChange,
  onReady,
}: {
  initialContent: unknown[];
  onChange: (doc: unknown[]) => void;
  onReady?: (handle: NotesEditorHandle) => void;
}) {
  const editor = useCreateBlockNote({
    initialContent: (initialContent.length ? initialContent : undefined) as PartialBlock[] | undefined,
  });
  const silent = useRef(false);

  useEffect(() => {
    onReady?.({
      replace(doc) {
        silent.current = true;
        try {
          const e = editor as BlockNoteEditor;
          e.replaceBlocks(e.document, (doc.length ? doc : [{ type: "paragraph" }]) as PartialBlock[]);
        } finally {
          // onChange fires synchronously inside replaceBlocks; release on the next tick to be safe.
          setTimeout(() => (silent.current = false), 0);
        }
      },
    });
  }, [editor, onReady]);

  return (
    <BlockNoteView
      editor={editor}
      onChange={() => {
        if (silent.current) return;
        onChange(editor.document as unknown[]);
      }}
      className="notes-editor"
    />
  );
}

export default NotesEditor;
