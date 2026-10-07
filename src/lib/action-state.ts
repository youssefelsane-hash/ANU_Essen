export interface ActionState {
  ok: boolean;
  message?: string;
  error?: string;
  /** Changes on every result so forms can react to repeated identical messages. */
  at?: number;
}
export const initialActionState: ActionState = { ok: false };
