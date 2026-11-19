import { create } from 'zustand';

/**
 * The editorial cover view's hand-off between the canvas and the page:
 * EditorialDriver (in the canvas) unveils the splat once its tier has
 * streamed in; EditorialView (DOM) shows its "arriving" cue until then.
 */
interface EditorialState {
  /** The focused model has stepped out from behind the curtain. */
  revealed: boolean;
}

export const useEditorialStore = create<EditorialState>(() => ({ revealed: false }));
