"# Wemiy-CLI""# Wemiy-cli-new" 
# Wemiy CLI 🚀

**Your AI coding agent inside the terminal**

```
__        __             _          ____ _     ___
\ \      / /__ _ __ ___ (_)_   _   / ___| |   |_ _|
 \ \ /\ / / _ \ '_ ` _ \| | | | | | |   | |    | |
  \ V  V /  __/ | | | | | | |_| | | |___| |___ | |
   \_/\_/ \___|_| |_| |_|_|\__, |  \____|_____|___|
                           |___/
Advanced Agentic AI CLI
```

Wemiy CLI is an intelligent command-line tool that brings AI directly into your development workflow.

It acts as an AI agent inside your terminal — helping you fix code, review changes, generate commits, and analyze your project with context-aware intelligence.

---

# ✨ Features

### 🤖 AI Code Fixing

Automatically fix bugs and improve your code:

```bash
wemiys fix <file>
```

---

### 🩺 Project Analysis (Doctor)

Detect issues in your project:

* Bugs
* Performance problems
* Security risks
* Bad practices

```bash
wemiys doctor
```

---

### 🧾 Smart Commits

Generate clean conventional commit messages:

```bash
wemiys commit
```

---

### 🔍 AI Code Review

Analyze your changes and get feedback:

```bash
wemiys review
```

---

### ⚙️ Model Selection

Switch between AI models:

```bash
wemiys model
```

---

# 🚀 Installation

## 1. Clone the repository

```bash
git clone https://github.com/yuncko/wemiy-cli.git
cd wemiy-cli
```

## 2. Install dependencies

```bash
npm install
```

## 3. Link CLI globally

```bash
npm link
```

## 4. Run

```bash
wemiys --help
```

---

# ⚙️ Setup

Create a `.env` file:

```env
OPENROUTER_API_KEY=your_api_key_here
```

---

# 🧪 Demo

### Fix a file

```bash
wemiys fix app.js
```

👉 Output:

```
✔ Issues detected
✔ Code improved
✔ Suggestions applied
```

---

### Generate commit

```bash
wemiys commit
```

👉 Output:

```
feat: improve authentication logic and fix edge cases
```

---

### Run doctor

```bash
wemiys doctor
```

👉 Output:

```
⚠ Found 3 issues:
- Unused dependencies
- Performance issue in API route
- Potential security risk (env exposure)
```

---

# 📸 Screenshots

## CLI Overview

```
$ wemiys --help
[commands list...]
```

## Code Fix Example

```
Before:
function test(){console.log("hi")}

After:
function test() {
  console.log("hi");
}
```

---

# 🧠 How It Works

Wemiy CLI uses:

* AI models via OpenRouter
* Structured system prompts
* Context-aware analysis

It doesn’t just execute commands — it **understands your code and acts on it**.

---

# 🧩 Use Cases

* Fix bugs instantly
* Improve code quality
* Generate commits automatically
* Review code locally
* Analyze project health

---

# 🛠️ Tech Stack

* Node.js
* JavaScript
* OpenRouter (AI models)
* CLI architecture

---

# 🚀 Vision

To transform the terminal into a fully intelligent development environment powered by AI agents.

---

# 📌 Roadmap

* [ ] Multi-file analysis
* [ ] Auto-refactor commands
* [ ] GitHub integration
* [ ] Interactive mode
* [ ] Custom prompt configs

---

# 🤝 Contributing

Pull requests, ideas, and feedback are welcome!

---

# ⭐ Support

If you like this project, consider giving it a star ⭐
