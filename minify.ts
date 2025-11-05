// minify.ts - watcher file and minifier for Deno created by cronchin
// Monitor and minify the CSS and JS files in the specified directories
// Save the minified version in the same directory with .min suffix
// Features:
// - CSS and JS minification with source maps
// - RTL CSS generation support (generates separate .rtl.min.css files)
// - Automatic logical properties conversion for better RTL support
// - Definitions.css integration and cleanup
// INSTRUCTIONS
// to use it run on your terminal follow command:
// deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi minify.ts

import { minify as minifyJs } from "https://esm.sh/terser@5.19.2";
import { parse, extname, join, dirname } from "https://deno.land/std@0.204.0/path/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.204.0/fs/ensure_dir.ts";

// Import lightningcss from npm
import { transform, browserslistToTargets } from "npm:lightningcss";
import browserslist from "npm:browserslist";

// Configuration of the directories to be monitored (paths relating to the current directory)
const WATCH_DIRECTORIES = {
    css: [
        "./assets/css",
        "./blocks",
    ],
    js: [
        "./assets/js",
        "./blocks",
    ]
};

// RTL support configuration
const RTL_CONFIG = {
    enabled: true,
    generateSeparateFiles: true, // Generate separate .rtl.min.css files
    rtlSuffix: '.rtl' // Suffix for RTL files
};

// File extensions to elaborate
const CSS_EXT = ".css";
const JS_EXT = ".js";

// global state
const processingFiles = new Set<string>();
const watchedDirectories = new Map<string, Set<string>>();

/**
 * Minify the CSS code
 */
async function minifyCss(input: string, filePath: string, isRtl: boolean = false): Promise<{code: string, map?: string}> {
    try {
        // --- START: Definitions Handling ---
        const definitionsPath = join(Deno.cwd(), "assets/css/definitions.css");
        let definitionsContent = "";
        try {
            definitionsContent = await Deno.readTextFile(definitionsPath);
            if (!definitionsContent.endsWith('\n')) {
                definitionsContent += '\n';
            }
        } catch (readError) {
            console.error(`⚠️ Could not read definitions file at ${definitionsPath}:`, readError);
        }

        // --- START: Remove @import 'definitions.css' rule ---
        // Regex to find @import rules pointing to definitions.css (adjust path variations if needed)
        const importRegex = /@import\s+(['"])(?:(?:\.\.\/)+)?assets\/css\/definitions\.css\1\s*;/g;
        const cleanedInput = input.replace(importRegex, '');
        // --- END: Remove @import 'definitions.css' rule ---

        // Prepend definitions content to the *cleaned* input CSS code
        const fullInput = definitionsContent + cleanedInput;
        // --- END: Definitions Handling ---


        let targets = browserslistToTargets(browserslist('>= 0.5%'));
        
        // Configure transform options with RTL support
        const transformOptions: any = {
            filename: filePath,
            // Use the combined input (definitions + cleaned original file content)
            code: new TextEncoder().encode(fullInput), // <--- Use fullInput
            minify: true,
            sourceMap: true,
            targets,
            drafts: {
                nesting: true,
                customMedia: true,
                mediaQueries: true
            }
        };
        
        // Add RTL-specific transformations if needed
        if (isRtl) {
            // lightningcss will automatically handle logical properties for RTL
            // We can add custom RTL transformations here if needed
        }
        
        const { code, map } = transform(transformOptions);

        // Decode the final code
        let finalCode = new TextDecoder().decode(code);

        // --- START: Remove prepended definitions from final output ---
        if (definitionsContent && finalCode.startsWith(definitionsContent.trim())) {
             const definitionsMinifiedApproximation = definitionsContent.split('\n')[0];
             const defEndIndex = finalCode.indexOf(definitionsMinifiedApproximation);
             if (defEndIndex !== -1) {
                 // Use the *cleaned* input to find the start of the original rules
                 const originalFirstRuleMatch = cleanedInput.match(/^\s*([@.]|\*|html|body|:root)/m);
                 if (originalFirstRuleMatch) {
                     const originalFirstRuleStart = originalFirstRuleMatch[0];
                     // Search for the start rule *after* the approximate end of definitions
                     const actualStartInMinified = finalCode.indexOf(originalFirstRuleStart, defEndIndex);
                     if (actualStartInMinified !== -1) {
                         finalCode = finalCode.substring(actualStartInMinified);
                     } else {
                         console.warn(`[${filePath}] Could not precisely remove prepended definitions. Output might contain duplicates.`);
                     }
                 } else {
                      console.warn(`[${filePath}] Could not find original start rule marker. Output might contain duplicates.`);
                 }
             }
        }
        // --- END: Remove prepended definitions from final output ---


        return {
            code: finalCode,
            map: map ? new TextDecoder().decode(map) : undefined
        };
    } catch (error) {
        // Provide more context in the error message
        console.error(`❌ dio boe, error during CSS minification for ${filePath}:`, error);
        // If the error is UnexpectedImportRule, add a specific hint
        if (error.data?.type === 'UnexpectedImportRule') {
             console.error("   Hint: This might be caused by an @import rule appearing after other CSS rules. Ensure all @import rules for 'definitions.css' are removed from source files if the build script prepends definitions.");
        }
        throw error; // Re-throw the error after logging
    }
}


/**
 * Minify the javascript code
 */
async function minifyJavaScript(input: string, filePath: string): Promise<{code: string, map?: string}> {
    try {
        const result = await minifyJs(input, {
            compress: true,
            mangle: true,
            sourceMap: {
                filename: parse(filePath).name,
                url: `${parse(filePath).name}.min.js.map`
            }
        });

        return {
            code: result.code || input,
            map: result.map as string
        };
    } catch (error) {
        console.error("❌ dio boe, error during javascript minification:", error);
        throw error;
    }
}

/**
 * Gets the destination path for the minified file
 */
function getDestPath(filePath: string, isRtl: boolean = false): string {
    const { dir, name, ext } = parse(filePath);
    const rtlSuffix = isRtl ? RTL_CONFIG.rtlSuffix : '';
    return join(dir, `${name}${rtlSuffix}.min${ext}`);
}

/**
 * Check if source file is newer than its minified version
 */
async function isSourceNewer(sourcePath: string): Promise<boolean> {
    try {
        const sourceStats = await Deno.stat(sourcePath);
        const extension = extname(sourcePath).toLowerCase();
        
        // Check main minified file
        const mainMinPath = getDestPath(sourcePath, false);
        let mainMinExists = false;
        let mainMinTime = new Date(0);
        
        try {
            const mainMinStats = await Deno.stat(mainMinPath);
            mainMinExists = true;
            mainMinTime = mainMinStats.mtime || new Date(0);
        } catch {
            // File doesn't exist, so source is "newer"
            return true;
        }
        
        // For CSS files, also check RTL version if enabled
        if (extension === CSS_EXT && RTL_CONFIG.enabled && RTL_CONFIG.generateSeparateFiles) {
            const rtlMinPath = getDestPath(sourcePath, true);
            try {
                const rtlMinStats = await Deno.stat(rtlMinPath);
                const rtlMinTime = rtlMinStats.mtime || new Date(0);
                
                // Source is newer if it's newer than either the main or RTL minified file
                const sourceTime = sourceStats.mtime || new Date(0);
                return sourceTime > mainMinTime || sourceTime > rtlMinTime;
            } catch {
                // RTL file doesn't exist, so source is "newer"
                return true;
            }
        }
        
        // For JS files or CSS without RTL, just check main minified file
        const sourceTime = sourceStats.mtime || new Date(0);
        return sourceTime > mainMinTime;
        
    } catch (error) {
        // If we can't read source file stats, assume it needs processing
        console.error(`⚠️ Could not check file stats for ${sourcePath}:`, error);
        return true;
    }
}

/**
 * Generate RTL version of CSS
 */
async function generateRtlCss(input: string, filePath: string): Promise<{code: string, map?: string}> {
    try {
        // Process CSS for RTL
        let rtlInput = input;
        
        // Add RTL-specific transformations
        // Convert remaining physical properties to logical ones for better RTL support
        rtlInput = rtlInput
            .replace(/margin-left:/g, 'margin-inline-start:')
            .replace(/margin-right:/g, 'margin-inline-end:')
            .replace(/padding-left:/g, 'padding-inline-start:')
            .replace(/padding-right:/g, 'padding-inline-end:')
            .replace(/border-left:/g, 'border-inline-start:')
            .replace(/border-right:/g, 'border-inline-end:')
            .replace(/left:/g, 'inset-inline-start:')
            .replace(/right:/g, 'inset-inline-end:')
            .replace(/text-align:\s*left/g, 'text-align: start')
            .replace(/text-align:\s*right/g, 'text-align: end');
        
        // Add RTL-specific CSS rules
        const rtlRules = `
/* RTL-specific styles */
[dir="rtl"] {
    direction: rtl;
}

[dir="rtl"] .transform-x {
    transform: scaleX(-1);
}

`;
        
        rtlInput = rtlRules + rtlInput;
        
        return await minifyCss(rtlInput, filePath, true);
    } catch (error) {
        console.error(`❌ Error generating RTL CSS for ${filePath}:`, error);
        throw error;
    }
}

/**
 * Provide a single file
 */
async function processFile(filePath: string, force: boolean = false): Promise<boolean> {
    // Jump if the file is already in processing
    if (processingFiles.has(filePath)) {
        return false;
    }

    // Jump if the file already has .min in the name to avoid recursive minification
    const { name } = parse(filePath);
    if (name.includes('.min')) {
        return false;
    }

    // Check if source file is newer than minified version (unless forced)
    if (!force) {
        const sourceIsNewer = await isSourceNewer(filePath);
        if (!sourceIsNewer) {
            // Source file is not newer than minified version, skip processing
            return false;
        }
    }

    // Add to the processing set
    processingFiles.add(filePath);

    try {
        // Gets the file extension
        const extension = extname(filePath).toLowerCase();

        // Jump if it's not a CSS or JS file
        if (extension !== CSS_EXT && extension !== JS_EXT) {
            return;
        }

        // Read the input file
        const input = await Deno.readTextFile(filePath);

        // Determine the output path
        const outputPath = getDestPath(filePath);

        // Ensures that the output directory exists
        ensureDirSync(dirname(outputPath));

        // Processes according to the type of file
        if (extension === CSS_EXT) {
            // Generate LTR version
            const ltrResult = await minifyCss(input, filePath, false);
            const ltrOutputPath = getDestPath(filePath, false);
            const ltrMapFilePath = ltrOutputPath + '.map';
            const ltrSourceMapComment = `\n/*# sourceMappingURL=${parse(ltrMapFilePath).base} */`;
            
            // Write LTR files
            await Deno.writeTextFile(ltrOutputPath, ltrResult.code + ltrSourceMapComment);
            if (ltrResult.map) {
                await Deno.writeTextFile(ltrMapFilePath, ltrResult.map);
            }
            
            // Generate RTL version if enabled
            if (RTL_CONFIG.enabled && RTL_CONFIG.generateSeparateFiles) {
                try {
                    const rtlResult = await generateRtlCss(input, filePath);
                    const rtlOutputPath = getDestPath(filePath, true);
                    const rtlMapFilePath = rtlOutputPath + '.map';
                    const rtlSourceMapComment = `\n/*# sourceMappingURL=${parse(rtlMapFilePath).base} */`;
                    
                    // Write RTL files
                    await Deno.writeTextFile(rtlOutputPath, rtlResult.code + rtlSourceMapComment);
                    if (rtlResult.map) {
                        await Deno.writeTextFile(rtlMapFilePath, rtlResult.map);
                    }
                    
                    // Log RTL generation
                    const timestamp = new Date().toLocaleTimeString();
                    const rtlReduction = Math.round((1 - rtlResult.code.length / input.length) * 100);
                    const rtlFileSize = new TextEncoder().encode(rtlResult.code).length;
                    const rtlFormattedSize = rtlFileSize < 1024 ? `${rtlFileSize} B` : `${(rtlFileSize / 1024).toFixed(1)} KB`;
                    console.log(`[${timestamp}] 🌍 RTL version generated (${Math.abs(rtlReduction)}% saved, total size: ${rtlFormattedSize}) | ${filePath} → ${rtlOutputPath}`);
                    
                    if (rtlResult.map) {
                        console.log(`[${timestamp}] 🗺️ RTL source map generated | ${rtlMapFilePath}`);
                    }
                } catch (rtlError) {
                    console.error(`⚠️ Failed to generate RTL version for ${filePath}:`, rtlError);
                }
            }
            
            // Log LTR generation
            const timestamp = new Date().toLocaleTimeString();
            const ltrReduction = Math.round((1 - ltrResult.code.length / input.length) * 100);
            const ltrFileSize = new TextEncoder().encode(ltrResult.code).length;
            const ltrFormattedSize = ltrFileSize < 1024 ? `${ltrFileSize} B` : `${(ltrFileSize / 1024).toFixed(1)} KB`;
            console.log(`[${timestamp}] 🌈 LTR version generated (${Math.abs(ltrReduction)}% saved, total size: ${ltrFormattedSize}) | ${filePath} → ${ltrOutputPath}`);
            
            if (ltrResult.map) {
                console.log(`[${timestamp}] 🗺️ LTR source map generated | ${ltrMapFilePath}`);
            }
            
        } else {
            // Handle JavaScript files (no RTL needed)
            const result = await minifyJavaScript(input, filePath);
            const mapFilePath = outputPath + '.map';
            const sourceMapComment = `\n//# sourceMappingURL=${parse(mapFilePath).base}`;
            
            // Write JS files
            await Deno.writeTextFile(outputPath, result.code + sourceMapComment);
            
            if (result.map) {
                await Deno.writeTextFile(mapFilePath, result.map);
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🗺️ source map generated | ${mapFilePath}`);
                
                const reduction = Math.round((1 - result.code.length / input.length) * 100);
                const fileSize = new TextEncoder().encode(result.code).length;
                const formattedSize = fileSize < 1024 ? `${fileSize} B` : `${(fileSize / 1024).toFixed(1)} KB`;
                console.log(`[${timestamp}] 🌈 (${Math.abs(reduction)}% saved, total size: ${formattedSize}) | ${filePath} → ${outputPath}`);
            }
        }
        
        // File was successfully processed
        return true;
    } catch (error) {
        // Error is now logged within minifyCss/minifyJavaScript if it occurs there
        // Only log general processing errors here
        if (!String(error).includes('CSS minification') && !String(error).includes('javascript minification')) {
             console.error(`❌ impossible to elaborate follow file ${filePath}:`, error);
        }
        return false;
    } finally {
        // Removes from the processing set
        processingFiles.delete(filePath);
    }
}

/**
 * Scan a directory for files with a certain extension
 */
async function scanDirectory(directory: string, fileExtension: string): Promise<string[]> {
        const files: string[] = [];

        try {
            for await (const entry of Deno.readDir(directory)) {
                const entryPath = join(directory, entry.name);

                if (entry.isDirectory) {
                    // If in the Blocks Director, the subdirectories also scan
                    if (directory.includes("blocks")) {
                        const subFiles = await scanDirectory(entryPath, fileExtension);
                        files.push(...subFiles);
                    }
                } else if (entry.isFile && entry.name.endsWith(fileExtension) && !entry.name.includes('.min')) {
                    files.push(entryPath);
                }
            }
        } catch (error) {
            console.error(`❌ dio boe, error when scanning the folder ${directory}:`, error);
        }

        return files;
    }

/**
 * Monitor a directory for changes in the files
 */
async function watchDirectory(directory: string, fileExtension: string): Promise<void> {
        try {
            // Check if the directory exists
            try {
                await Deno.stat(directory);
            } catch (error) {
                console.error(`❌ follow directory ${directory} does not exist. monitoring skipped.`);
                return;
            }

            console.log(`👀 monitoring of ${directory} for modification to files ${fileExtension}...`);

            // Provide the existing files to the first start (only if they need updating)
            const existingFiles = await scanDirectory(directory, fileExtension);
            let processedCount = 0;
            for (const file of existingFiles) {
                const wasProcessed = await processFile(file, false); // Don't force, check timestamps
                if (wasProcessed) processedCount++;
            }
            if (processedCount > 0) {
                console.log(`📦 Processed ${processedCount} files that needed updating on startup`);
            } else {
                console.log(`✅ All files are up to date, no processing needed on startup`);
            }

            // Configure the Watcher for this directory
            const watcher = Deno.watchFs(directory);

            // Monitor file System events
            for await (const event of watcher) {
                if (event.kind === "modify" || event.kind === "create") {
                    for (const path of event.paths) {
                        if (path.endsWith(fileExtension)) {
                            // jump the files they already have .min in the name
                            const { name } = parse(path);
                            if (name.includes('.min')) {
                                continue;
                            }

                            // Check if this file is already elaborated by another Watcher
                            // *** FIX: Use fileExtension instead of extension ***
                            const dirKey = `${directory}:${fileExtension}`;
                            const watchedFiles = watchedDirectories.get(dirKey);

                            // If this file is already in processing, jump it
                            if (watchedFiles && watchedFiles.has(path)) {
                                continue;
                            }

                            // Mark this file as in processing from this watcher
                            if (watchedFiles) {
                                watchedFiles.add(path);

                                // removes the file from the set after processing
                                setTimeout(() => {
                                    watchedFiles.delete(path);
                                }, 1000); // wait 1 second before allowing the file to be elaborated again
                            }

                            // Provide the file when it changes (ctrl+s) - force processing
                            await processFile(path, true);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ dio boe, error when monitoring the folder ${directory}:`, error);
        }
    }

/**
 * Funzione principale
 */
async function main() {
        console.log("<-- 🔍 CSS & JS watcher e minifier -->");
        console.log(`📦 Minified files will be saved in the same directory with .min suffix`);
        console.log(`🗺️ Source Map will be generated for all files`);
        
        if (RTL_CONFIG.enabled && RTL_CONFIG.generateSeparateFiles) {
            console.log(`🌍 RTL support enabled - generating separate ${RTL_CONFIG.rtlSuffix}.min.css files`);
        }
        
        console.log("⚠️ Press Ctrl+C to arrest the watcher\n");

        // Remove the call to initCssWasm since we're using the npm version now
        // which doesn't require initialization

        const startWatcher = async (directories: string[], extension: string) => {
            for (const directory of directories) {
                const dirKey = `${directory}:${extension}`;
                if (!watchedDirectories.has(dirKey)) {
                    watchedDirectories.set(dirKey, new Set());
                    watchDirectory(directory, extension);
                }
            }
        };

        // Start watcher for CSS directories
        await startWatcher(WATCH_DIRECTORIES.css, CSS_EXT);

        // Start watcher for the JS directories
        await startWatcher(WATCH_DIRECTORIES.js, JS_EXT);
    }

// Performs the main function
if (import.meta.main) {
    main();
}
