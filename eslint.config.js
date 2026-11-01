// SPDX-License-Identifier: GPL-2.0-or-later

// Lint with: npx eslint@9 .
// Follows the GNOME Shell code style; kept free of plugins so it runs as is.

const gjsGlobals = {
    ARGV: 'readonly',
    console: 'readonly',
    global: 'readonly',
    globalThis: 'readonly',
    imports: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
};

export default [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            'array-bracket-spacing': ['error', 'never'],
            'arrow-parens': ['error', 'as-needed'],
            'brace-style': ['error', '1tbs', {allowSingleLine: true}],
            'comma-dangle': ['error', 'always-multiline'],
            'comma-spacing': 'error',
            'eol-last': 'error',
            'eqeqeq': 'error',
            'indent': ['error', 4, {
                ignoredNodes: [
                    'CallExpression > ArrowFunctionExpression > .body',
                    // GObject.registerClass(class ... {}) keeps the class body at one level
                    'CallExpression[callee.object.name=GObject][callee.property.name=registerClass] > ClassExpression',
                ],
                MemberExpression: 'off',
                SwitchCase: 1,
            }],
            'key-spacing': 'error',
            'keyword-spacing': 'error',
            'no-const-assign': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-imports': 'error',
            'no-empty': ['error', {allowEmptyCatch: true}],
            'no-multi-spaces': 'error',
            'no-redeclare': 'error',
            'no-shadow': 'error',
            'no-trailing-spaces': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            'no-use-before-define': ['error', {functions: false, classes: true}],
            'no-var': 'error',
            'object-curly-spacing': ['error', 'never'],
            'prefer-const': 'error',
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'space-before-blocks': 'error',
            'space-before-function-paren': ['error', {
                anonymous: 'never',
                named: 'never',
                asyncArrow: 'always',
            }],
            'space-infix-ops': 'error',
        },
    },
];
