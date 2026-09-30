export default {
  ignoreFiles: ['dist/**', 'coverage/**', 'node_modules/**'],
  rules: {
    // ── Syntax & Integrity Rules ─────────────────────────────────────────
    'color-no-invalid-hex': true,
    'custom-property-no-missing-var-function': true,
    'custom-property-pattern': [
      '^[a-z0-9_-]+$',
      {
        message:
          'Custom properties must follow lowercase naming with hyphens or underscores (e.g. --rt-color-accent).',
      },
    ],
    'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-shorthand-property-overrides': true,
    'declaration-block-no-duplicate-properties': [
      true,
      {
        ignore: ['consecutive-duplicates-with-different-values'],
        message: 'Avoid duplicate properties in the same declaration block.',
      },
    ],
    'property-no-unknown': true,
    'unit-no-unknown': true,
    'keyframe-declaration-no-important': true,
    'font-family-no-missing-generic-family-keyword': true,
    'font-family-no-duplicate-names': true,
    'function-calc-no-unspaced-operator': true,
    'media-feature-name-no-unknown': true,
    'selector-pseudo-class-no-unknown': true,
    'selector-pseudo-element-no-unknown': true,
    'selector-type-no-unknown': true,
    'length-zero-no-unit': true,
    'block-no-empty': true,
  },
  overrides: [
    {
      files: ['src/**/*.css'],
      rules: {
        // ── Design Token Color Consistency ─────────────────────────────
        'color-no-hex': [
          true,
          {
            severity: 'warning',
            message: 'Use RevTube design tokens (var(--rt-color-*)) instead of raw hex colors.',
          },
        ],
        'color-named': [
          'never',
          {
            ignore: ['inside-function'],
            message: 'Use RevTube design tokens (var(--rt-color-*)) instead of named colors.',
          },
        ],

        // ── Typography Consistency ───────────────────────────────────────
        'declaration-property-value-disallowed-list': [
          {
            'font-family': [/^(?!var\(--rt-font|monospace|inherit|ui-monospace).+$/],
          },
          {
            message:
              'Use RevTube font tokens (var(--rt-font-sans) or var(--rt-font-mono)) instead of raw font stacks.',
          },
        ],

        // ── Specificity & Modular Layout ────────────────────────────────
        'selector-max-id': [
          0,
          {
            message:
              'Avoid ID selectors in CSS. Use semantic class names for consistent specificity and modularity.',
          },
        ],
      },
    },
    {
      // design-tokens.css is the single source of truth for palette & font definitions
      files: ['src/styles/design-tokens.css'],
      rules: {
        'color-no-hex': null,
        'color-named': null,
        'declaration-property-value-disallowed-list': null,
      },
    },
    {
      // index.css contains the single React DOM mount selector (#root)
      files: ['src/index.css'],
      rules: {
        'selector-max-id': null,
      },
    },
  ],
};
