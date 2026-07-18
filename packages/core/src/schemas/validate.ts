import { Ajv2020 as Ajv, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  elementSchema,
  relationshipSchema,
  stateSchema,
  viewSchema,
  workspaceSchema,
} from "./schemas.js";

export type FileKind = "workspace" | "element" | "relationship" | "view" | "state";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validators: Record<FileKind, ValidateFunction> = {
  workspace: ajv.compile(workspaceSchema),
  element: ajv.compile(elementSchema),
  relationship: ajv.compile(relationshipSchema),
  view: ajv.compile(viewSchema),
  state: ajv.compile(stateSchema),
};

/** Validate a parsed JSON value against the schema for its file kind. Returns human-readable issues. */
export function validateFile(kind: FileKind, value: unknown): string[] {
  const validate = validators[kind];
  if (validate(value)) return [];
  return (validate.errors ?? []).map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? "is invalid"}`;
  });
}

export const schemas = {
  workspace: workspaceSchema,
  element: elementSchema,
  relationship: relationshipSchema,
  view: viewSchema,
  state: stateSchema,
} as const;
