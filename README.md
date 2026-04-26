"# Wemiy-CLI""# Wemiy-cli-new" 
# Wemiy CLI

Wemiy CLI is a powerful command-line interface that enhances your development workflow with AI-powered features. From bug fixes to code reviews and commit generation, Wemiy helps you write better code faster.

## Features

- **🐛 Fix Bugs**: Use AI to identify and fix issues in your code.
- **🩺 Doctor**: Analyze your project for bugs, performance issues, security risks, and bad practices.
- **📝 Conventional Commits**: Automatically generate commit messages that follow the Conventional Commits specification.
- **🔍 Code Review**: Get AI-powered code reviews for your changes.
- **🚀 PR Ready**: Automate your entire pre-PR workflow with a single command.
- **🧠 Model Selection**: Easily switch between different AI models.
- **⏰ Wake Up**: Start your day with an AI assistant.

---

### 🚀 PR Ready — Ship in One Command

Automate your entire pre-PR workflow with a single command:

```bash
wemiy pr-ready
```

What it does automatically:

1. 🔍 Reviews your code and fixes trivial issues
2. 🧪 Generates missing test files
3. 📝 Creates a conventional commit message
4. 📋 Writes a full PR description + copies it to clipboard
5. 🏁 Shows a summary of everything that happened

Dry run (preview without changing anything):

```bash
wemiy pr-ready --dry-run
```

---

## Installation

```bash
# Install globally
globalpm install Wemiy-cli

# Or install locally
pm install Wemiy-cli
```

## Roadmap

- [x] Auto-refactor commands ✅