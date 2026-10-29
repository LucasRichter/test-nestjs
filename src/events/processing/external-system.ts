export const EXTERNAL_SYSTEM = Symbol('EXTERNAL_SYSTEM');

export interface ExternalCall {
  id: string;
  patientId: string;
  type: string;
}

export interface ExternalSystem {
  apply(event: ExternalCall): Promise<void>;
}
