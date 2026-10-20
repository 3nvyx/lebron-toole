"use client";

import dynamic from "next/dynamic";
import { EditorSkeleton } from "./skeletons";

// BlockNote touches the DOM at import time, so it only loads in the browser.
// `ssr: false` is only allowed inside a Client Component, which this file is.
export const DynamicNotesEditor = dynamic(() => import("./notes-editor").then((m) => m.NotesEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
