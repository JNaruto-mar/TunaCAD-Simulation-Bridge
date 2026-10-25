/** Experimental release qualified by the genuine normal-owner campaign.
 * Not an environment, project-file, HTTP or runtime configuration switch.
 * Saved integrity-only project copies remain readable independently. */
export const NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED=true;
export const NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED=true;
// Compatibility for older consumers. Qualification of one capability must
// never enable capture for the other, or unlock legacy protected export.
export const NEW_PROJECT_RESULT_CAPTURE_ENABLED=
  NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED&&NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED;
