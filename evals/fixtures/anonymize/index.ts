/** Label anonymizer (M1 T5, D8): pure, deterministic, schema-preserving. */
export { type AnonymizeOptions, LONG_TEXT_MIN_LENGTH, anonymize } from './anonymize';
export { EXTRA_IDENTITY, extraIdentityFor } from './extra-identity';
export { type LabelLeak, type LeakCheckOptions, type LeakKind, findLabelLeaks } from './leaks';
