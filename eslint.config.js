import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'node_modules',
    'node_modules/**',
    '.md',
    '.pnp',
    '.pnp/**',
    '.pnp.js',
    '**/.pnp.js/**',
    'coverage',
    'coverage/**',
    'test-results/',
    'test-results/**/',
    'playwright-report/',
    'playwright-report/**/',
    'playwright/.cache/',
    'playwright/.cache/**/',
    'dist',
    'dist/**',
    'high-level-dependencies.html',
    '**/high-level-dependencies.html/**',
    '.DS_Store',
    '**/.DS_Store/**',
    '*.pem',
    '**/*.pem/**',
    'npm-debug.log*',
    '**/npm-debug.log*/**',
    'yarn-debug.log*',
    '**/yarn-debug.log*/**',
    'yarn-error.log*',
    '**/yarn-error.log*/**',
    '.pnpm-debug.log*',
    '**/.pnpm-debug.log*/**',
    '.env*.local',
    '**/.env*.local/**',
    '.vercel',
    '**/.vercel/**',
    '**/.sisyphus/**',
    '**/*.agent/**',
    '**/*.cursor/**',
    '**/docs/**',
    '**/*.md/**',
  ],
  rules: {
    // 允许使用 console.debug (用于调试功能)
    'no-console': [
      'error',
      {
        allow: ['warn', 'error', 'debug'],
      },
    ],
  },
}, {
  files: ['src/engine/runtime/**/*.js'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/game/**',
              '**/editor/**',
              '**/app/**',
              '**/main.js',
            ],
            message: 'Runtime modules must not depend on game, editor or app.',
          },
        ],
      },
    ],
  },
}, {
  files: ['src/engine/editor/**/*.js'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/game/**', '**/app/**'],
            message: 'App injects game operations into editor.',
          },
        ],
      },
    ],
  },
}, {
  files: ['src/game/**/*.js'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/editor/**', '**/app/**'],
            message: 'Game content must run independently of editor/app.',
          },
        ],
      },
    ],
  },
}, {
  files: ['tests/**/*.mjs'],
  rules: {
    'test/no-import-node-test': 'off', // The project uses Node's built-in runner, not Vitest.
  },
}, {
  files: ['tools/**/*.mjs'],
  rules: {
    'no-console': 'off', // CLI tools emit machine-readable validation reports.
    'antfu/no-top-level-await': 'off', // Standalone ESM CLI entry points.
  },
})
