import { spawn } from "node:child_process"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwind from "@tailwindcss/postcss"
import postcss from "postcss"

const CAPTURE_WIDGET_CSS_PLACEHOLDER = "__CRIKKET_CAPTURE_WIDGET_CSS__"
const CAPTURE_LAUNCHER_CSS_PLACEHOLDER = "__CRIKKET_CAPTURE_LAUNCHER_CSS__"
const USE_CLIENT_DIRECTIVE_PATTERN =
  /(^|\n)[\t ]*(["'])use client\2;?[\t ]*(?=\n|$)/g
const DUPLICATE_INDEX_EXPORT_PATTERN =
  /\nexport \{ init, mount, unmount, open, close, destroy, startRecording, stopRecording, takeScreenshot, submit, reset, isInitialized, getConfig, getCoreVersion \};\n/g

const esmBuildEntrypoints = [
  "./src/index.ts",
  "./src/browser.ts",
  "./src/plugin.tsx",
] as const
const esmBuildExternalPackages = [
  "react",
  "react-dom",
  "react-dom/client",
] as const

async function main(): Promise<void> {
  process.chdir(fileURLToPath(new URL("../", import.meta.url)))

  await rm("./dist", {
    force: true,
    recursive: true,
  })
  await mkdir("./dist", {
    recursive: true,
  })
  await rm("./src/capture.global.js", { force: true })
  await rm("./src/capture.global.js.map", { force: true })

  const [widgetCss, launcherCss] = await Promise.all([
    buildPostcssAsset("./src/ui/widget.css", "./dist/capture.css"),
    buildRawCssAsset("./src/ui/launcher.css", "./dist/launcher.css"),
  ])
  const esmBuildExitCode = await runCommand([
    "bun",
    "build",
    ...esmBuildEntrypoints,
    "--target=browser",
    "--format=esm",
    "--splitting",
    "--packages=bundle",
    "--sourcemap=linked",
    "--outdir=./dist",
    ...esmBuildExternalPackages.map((value) => `--external=${value}`),
  ])
  if (esmBuildExitCode !== 0) {
    throw new Error("Failed to build ESM capture SDK bundles.")
  }

  const globalBuildExitCode = await runCommand([
    "bun",
    "build",
    "./src/global.ts",
    "--target=browser",
    "--format=iife",
    "--packages=bundle",
    "--sourcemap=linked",
    "--outfile=./dist/capture.global.js",
  ])
  if (globalBuildExitCode !== 0) {
    throw new Error("Failed to build global capture SDK bundle.")
  }

  await moveGeneratedGlobalBuildOutput()

  await sanitizeDistJavaScript({
    launcherCss,
    widgetCss,
  })

  const exitCode = await runCommand([
    "bun",
    "x",
    "tsc",
    "--emitDeclarationOnly",
    "-p",
    "tsconfig.json",
  ])
  if (exitCode !== 0) {
    throw new Error("Type declaration build failed.")
  }

  await writeReactEntry()
}

async function buildPostcssAsset(
  inputPath: string,
  outputPath: string
): Promise<string> {
  const cssSourcePath = resolve(inputPath)
  const cssInput = await readFile(cssSourcePath, "utf8")
  const result = await postcss([tailwind()]).process(cssInput, {
    from: cssSourcePath,
    to: resolve(outputPath),
  })

  await mkdir("./dist", {
    recursive: true,
  })
  await writeFile(outputPath, result.css)
  return result.css
}

async function buildRawCssAsset(
  inputPath: string,
  outputPath: string
): Promise<string> {
  const css = await readFile(resolve(inputPath), "utf8")
  await mkdir("./dist", {
    recursive: true,
  })
  await writeFile(outputPath, css)
  return css
}

async function sanitizeDistJavaScript(input: {
  launcherCss: string
  widgetCss: string
}): Promise<void> {
  for (const filePath of await findJavaScriptFiles("./dist")) {
    const bundle = await readFile(filePath, "utf8")
    const updatedBundle = stripUseClientDirectives(
      bundle
        .replaceAll(
          JSON.stringify(CAPTURE_WIDGET_CSS_PLACEHOLDER),
          JSON.stringify(input.widgetCss)
        )
        .replaceAll(
          JSON.stringify(CAPTURE_LAUNCHER_CSS_PLACEHOLDER),
          JSON.stringify(input.launcherCss)
        )
    )

    await writeFile(filePath, stripDuplicateIndexExports(updatedBundle))
  }
}

async function writeReactEntry(): Promise<void> {
  await writeFile(
    "./dist/react.js",
    'export { CapturePlugin } from "./plugin.js"\n'
  )
}

function stripUseClientDirectives(source: string): string {
  return source.replaceAll(USE_CLIENT_DIRECTIVE_PATTERN, "$1")
}

function stripDuplicateIndexExports(source: string): string {
  return source.replaceAll(DUPLICATE_INDEX_EXPORT_PATTERN, "\n")
}

async function findJavaScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })

  const output: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const filePath = resolve(entry.parentPath, entry.name)
    if (extname(filePath) !== ".js") {
      continue
    }

    output.push(filePath)
  }

  return output
}

async function moveGeneratedGlobalBuildOutput(): Promise<void> {
  if (await pathExists("./src/capture.global.js")) {
    await rename("./src/capture.global.js", "./dist/capture.global.js")
  }

  if (await pathExists("./src/capture.global.js.map")) {
    await rename("./src/capture.global.js.map", "./dist/capture.global.js.map")
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

function runCommand(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      shell: false,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      resolve(code ?? 1)
    })
  })
}

await main()
