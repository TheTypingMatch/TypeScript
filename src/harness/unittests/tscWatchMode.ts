/// <reference path="..\harness.ts" />
/// <reference path="..\..\compiler\tscLib.ts" />
/// <reference path="..\virtualFileSystemWithWatch.ts" />

namespace ts.tscWatch {

    export import WatchedSystem = ts.TestFSWithWatch.TestServerHost;
    export type TestServerHostCreationParameters = ts.TestFSWithWatch.TestServerHostCreationParameters;
    export type File = ts.TestFSWithWatch.File;
    export type FileOrFolder = ts.TestFSWithWatch.FileOrFolder;
    export type Folder = ts.TestFSWithWatch.Folder;
    export type FSEntry = ts.TestFSWithWatch.FSEntry;
    export import createWatchedSystem = ts.TestFSWithWatch.createWatchedSystem;
    export import checkFileNames = ts.TestFSWithWatch.checkFileNames;
    export import libFile = ts.TestFSWithWatch.libFile;
    export import checkWatchedFiles = ts.TestFSWithWatch.checkWatchedFiles;
    export import checkWatchedDirectories = ts.TestFSWithWatch.checkWatchedDirectories;
    export import checkOutputContains = ts.TestFSWithWatch.checkOutputContains;
    export import checkOutputDoesNotContain = ts.TestFSWithWatch.checkOutputDoesNotContain;

    export function checkProgramActualFiles(program: Program, expectedFiles: string[]) {
        checkFileNames(`Program actual files`, program.getSourceFiles().map(file => file.fileName), expectedFiles);
    }

    export function checkProgramRootFiles(program: Program, expectedFiles: string[]) {
        checkFileNames(`Program rootFileNames`, program.getRootFileNames(), expectedFiles);
    }

    function createWatchingSystemHost(system: WatchedSystem) {
        return ts.createWatchingSystemHost(/*pretty*/ undefined, system);
    }

    function parseConfigFile(configFileName: string, watchingSystemHost: WatchingSystemHost) {
        return ts.parseConfigFile(configFileName, {}, watchingSystemHost.system, watchingSystemHost.reportDiagnostic, watchingSystemHost.reportWatchDiagnostic);
    }

    function createWatchModeWithConfigFile(configFilePath: string, host: WatchedSystem) {
        const watchingSystemHost = createWatchingSystemHost(host);
        const configFileResult = parseConfigFile(configFilePath, watchingSystemHost);
        return ts.createWatchModeWithConfigFile(configFileResult, {}, watchingSystemHost);
    }

    function createWatchModeWithoutConfigFile(fileNames: string[], host: WatchedSystem, options: CompilerOptions = {}) {
        const watchingSystemHost = createWatchingSystemHost(host);
        return ts.createWatchModeWithoutConfigFile(fileNames, options, watchingSystemHost);
    }

    function getEmittedLineForMultiFileOutput(file: FileOrFolder, host: WatchedSystem) {
        return `TSFILE: ${file.path.replace(".ts", ".js")}${host.newLine}`;
    }

    function getEmittedLineForSingleFileOutput(filename: string, host: WatchedSystem) {
        return `TSFILE: ${filename}${host.newLine}`;
    }

    interface FileOrFolderEmit extends FileOrFolder {
        output?: string;
    }

    function getFileOrFolderEmit(file: FileOrFolder, getOutput?: (file: FileOrFolder) => string): FileOrFolderEmit {
        const result = file as FileOrFolderEmit;
        if (getOutput) {
            result.output = getOutput(file);
        }
        return result;
    }

    function getEmittedLines(files: FileOrFolderEmit[]) {
        const seen = createMap<true>();
        const result: string[] = [];
        for (const { output} of files) {
            if (output && !seen.has(output)) {
                seen.set(output, true);
                result.push(output);
            }
        }
        return result;
    }

    function checkAffectedLines(host: WatchedSystem, affectedFiles: FileOrFolderEmit[], allEmittedFiles: string[]) {
        const expectedAffectedFiles = getEmittedLines(affectedFiles);
        const expectedNonAffectedFiles = mapDefined(allEmittedFiles, line => contains(expectedAffectedFiles, line) ? undefined : line);
        checkOutputContains(host, expectedAffectedFiles);
        checkOutputDoesNotContain(host, expectedNonAffectedFiles);
    }

    describe("tsc-watch program updates", () => {
        const commonFile1: FileOrFolder = {
            path: "/a/b/commonFile1.ts",
            content: "let x = 1"
        };
        const commonFile2: FileOrFolder = {
            path: "/a/b/commonFile2.ts",
            content: "let y = 1"
        };

        it("create watch without config file", () => {
            const appFile: FileOrFolder = {
                path: "/a/b/c/app.ts",
                content: `
                import {f} from "./module"
                console.log(f)
                `
            };

            const moduleFile: FileOrFolder = {
                path: "/a/b/c/module.d.ts",
                content: `export let x: number`
            };
            const host = createWatchedSystem([appFile, moduleFile, libFile]);
            const watch = createWatchModeWithoutConfigFile([appFile.path], host);

            checkProgramActualFiles(watch(), [appFile.path, libFile.path, moduleFile.path]);

            // TODO: Should we watch creation of config files in the root file's file hierarchy?

            // const configFileLocations = ["/a/b/c/", "/a/b/", "/a/", "/"];
            // const configFiles = flatMap(configFileLocations, location => [location + "tsconfig.json", location + "jsconfig.json"]);
            // checkWatchedFiles(host, configFiles.concat(libFile.path, moduleFile.path));
        });

        it("can handle tsconfig file name with difference casing", () => {
            const f1 = {
                path: "/a/b/app.ts",
                content: "let x = 1"
            };
            const config = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({
                    include: ["app.ts"]
                })
            };

            const host = createWatchedSystem([f1, config], { useCaseSensitiveFileNames: false });
            const upperCaseConfigFilePath = combinePaths(getDirectoryPath(config.path).toUpperCase(), getBaseFileName(config.path));
            const watch = createWatchModeWithConfigFile(upperCaseConfigFilePath, host);
            checkProgramActualFiles(watch(), [f1.path]);
        });

        it("create configured project without file list", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `
                {
                    "compilerOptions": {},
                    "exclude": [
                        "e"
                    ]
                }`
            };
            const file1: FileOrFolder = {
                path: "/a/b/c/f1.ts",
                content: "let x = 1"
            };
            const file2: FileOrFolder = {
                path: "/a/b/d/f2.ts",
                content: "let y = 1"
            };
            const file3: FileOrFolder = {
                path: "/a/b/e/f3.ts",
                content: "let z = 1"
            };

            const host = createWatchedSystem([configFile, libFile, file1, file2, file3]);
            const watchingSystemHost = createWatchingSystemHost(host);
            const configFileResult = parseConfigFile(configFile.path, watchingSystemHost);
            assert.equal(configFileResult.errors.length, 0, `expect no errors in config file, got ${JSON.stringify(configFileResult.errors)}`);

            const watch = ts.createWatchModeWithConfigFile(configFileResult, {}, watchingSystemHost);

            checkProgramActualFiles(watch(), [file1.path, libFile.path, file2.path]);
            checkProgramRootFiles(watch(), [file1.path, file2.path]);
            checkWatchedFiles(host, [configFile.path, file1.path, file2.path, libFile.path]);
            checkWatchedDirectories(host, [getDirectoryPath(configFile.path)], /*recursive*/ true);
        });

        // TODO: if watching for config file creation
        // it("add and then remove a config file in a folder with loose files", () => {
        // });

        it("add new files to a configured program without file list", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{}`
            };
            const host = createWatchedSystem([commonFile1, libFile, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkWatchedDirectories(host, ["/a/b"], /*recursive*/ true);

            checkProgramRootFiles(watch(), [commonFile1.path]);

            // add a new ts file
            host.reloadFS([commonFile1, commonFile2, libFile, configFile]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);
        });

        it("should ignore non-existing files specified in the config file", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {},
                    "files": [
                        "commonFile1.ts",
                        "commonFile3.ts"
                    ]
                }`
            };
            const host = createWatchedSystem([commonFile1, commonFile2, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);

            const commonFile3 = "/a/b/commonFile3.ts";
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile3]);
            checkProgramActualFiles(watch(), [commonFile1.path]);
        });

        it("handle recreated files correctly", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{}`
            };
            const host = createWatchedSystem([commonFile1, commonFile2, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);

            // delete commonFile2
            host.reloadFS([commonFile1, configFile]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [commonFile1.path]);

            // re-add commonFile2
            host.reloadFS([commonFile1, commonFile2, configFile]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);
        });

        it("handles the missing files - that were added to program because they were added with ///<ref", () => {
            const file1: FileOrFolder = {
                path: "/a/b/commonFile1.ts",
                content: `/// <reference path="commonFile2.ts"/>
                    let x = y`
            };
            const host = createWatchedSystem([file1, libFile]);
            const watch = createWatchModeWithoutConfigFile([file1.path], host);

            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, libFile.path]);
            const errors = [
                `a/b/commonFile1.ts(1,22): error TS6053: File '${commonFile2.path}' not found.${host.newLine}`,
                `a/b/commonFile1.ts(2,29): error TS2304: Cannot find name 'y'.${host.newLine}`
            ];
            checkOutputContains(host, errors);
            host.clearOutput();

            host.reloadFS([file1, commonFile2, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, libFile.path, commonFile2.path]);
            checkOutputDoesNotContain(host, errors);
        });

        it("should reflect change in config file", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {},
                    "files": ["${commonFile1.path}", "${commonFile2.path}"]
                }`
            };
            const files = [commonFile1, commonFile2, configFile];
            const host = createWatchedSystem(files);
            const watch = createWatchModeWithConfigFile(configFile.path, host);

            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);
            configFile.content = `{
                "compilerOptions": {},
                "files": ["${commonFile1.path}"]
            }`;

            host.reloadFS(files);
            host.checkTimeoutQueueLengthAndRun(1); // reload the configured project
            checkProgramRootFiles(watch(), [commonFile1.path]);
        });

        it("files explicitly excluded in config file", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {},
                    "exclude": ["/a/c"]
                }`
            };
            const excludedFile1: FileOrFolder = {
                path: "/a/c/excluedFile1.ts",
                content: `let t = 1;`
            };

            const host = createWatchedSystem([commonFile1, commonFile2, excludedFile1, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);
        });

        it("should properly handle module resolution changes in config file", () => {
            const file1: FileOrFolder = {
                path: "/a/b/file1.ts",
                content: `import { T } from "module1";`
            };
            const nodeModuleFile: FileOrFolder = {
                path: "/a/b/node_modules/module1.ts",
                content: `export interface T {}`
            };
            const classicModuleFile: FileOrFolder = {
                path: "/a/module1.ts",
                content: `export interface T {}`
            };
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {
                        "moduleResolution": "node"
                    },
                    "files": ["${file1.path}"]
                }`
            };
            const files = [file1, nodeModuleFile, classicModuleFile, configFile];
            const host = createWatchedSystem(files);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, nodeModuleFile.path]);

            configFile.content = `{
                "compilerOptions": {
                    "moduleResolution": "classic"
                },
                "files": ["${file1.path}"]
            }`;
            host.reloadFS(files);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, classicModuleFile.path]);
        });

        it("should tolerate config file errors and still try to build a project", () => {
            const configFile: FileOrFolder = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {
                        "target": "es6",
                        "allowAnything": true
                    },
                    "someOtherProperty": {}
                }`
            };
            const host = createWatchedSystem([commonFile1, commonFile2, libFile, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramRootFiles(watch(), [commonFile1.path, commonFile2.path]);
        });

        it("changes in files are reflected in project structure", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: `export * from "./f2"`
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: `export let x = 1`
            };
            const file3 = {
                path: "/a/c/f3.ts",
                content: `export let y = 1;`
            };
            const host = createWatchedSystem([file1, file2, file3]);
            const watch = createWatchModeWithoutConfigFile([file1.path], host);
            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, file2.path]);

            const modifiedFile2 = {
                path: file2.path,
                content: `export * from "../c/f3"` // now inferred project should inclule file3
            };

            host.reloadFS([file1, modifiedFile2, file3]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [file1.path]);
            checkProgramActualFiles(watch(), [file1.path, modifiedFile2.path, file3.path]);
        });

        it("deleted files affect project structure", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: `export * from "./f2"`
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: `export * from "../c/f3"`
            };
            const file3 = {
                path: "/a/c/f3.ts",
                content: `export let y = 1;`
            };
            const host = createWatchedSystem([file1, file2, file3]);
            const watch = createWatchModeWithoutConfigFile([file1.path], host);
            checkProgramActualFiles(watch(), [file1.path, file2.path, file3.path]);

            host.reloadFS([file1, file3]);
            host.checkTimeoutQueueLengthAndRun(1);

            checkProgramActualFiles(watch(), [file1.path]);
        });

        it("deleted files affect project structure - 2", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: `export * from "./f2"`
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: `export * from "../c/f3"`
            };
            const file3 = {
                path: "/a/c/f3.ts",
                content: `export let y = 1;`
            };
            const host = createWatchedSystem([file1, file2, file3]);
            const watch = createWatchModeWithoutConfigFile([file1.path, file3.path], host);
            checkProgramActualFiles(watch(), [file1.path, file2.path, file3.path]);

            host.reloadFS([file1, file3]);
            host.checkTimeoutQueueLengthAndRun(1);

            checkProgramActualFiles(watch(), [file1.path, file3.path]);
        });

        it("config file includes the file", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: "export let x = 5"
            };
            const file2 = {
                path: "/a/c/f2.ts",
                content: `import {x} from "../b/f1"`
            };
            const file3 = {
                path: "/a/c/f3.ts",
                content: "export let y = 1"
            };
            const configFile = {
                path: "/a/c/tsconfig.json",
                content: JSON.stringify({ compilerOptions: {}, files: ["f2.ts", "f3.ts"] })
            };

            const host = createWatchedSystem([file1, file2, file3, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);

            checkProgramRootFiles(watch(), [file2.path, file3.path]);
            checkProgramActualFiles(watch(), [file1.path, file2.path, file3.path]);
        });

        it("correctly migrate files between projects", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: `
                export * from "../c/f2";
                export * from "../d/f3";`
            };
            const file2 = {
                path: "/a/c/f2.ts",
                content: "export let x = 1;"
            };
            const file3 = {
                path: "/a/d/f3.ts",
                content: "export let y = 1;"
            };
            const host = createWatchedSystem([file1, file2, file3]);
            const watch = createWatchModeWithoutConfigFile([file2.path, file3.path], host);
            checkProgramActualFiles(watch(), [file2.path, file3.path]);

            const watch2 = createWatchModeWithoutConfigFile([file1.path], host);
            checkProgramActualFiles(watch2(), [file1.path, file2.path, file3.path]);

            // Previous program shouldnt be updated
            checkProgramActualFiles(watch(), [file2.path, file3.path]);
            host.checkTimeoutQueueLength(0);
        });

        it("can correctly update configured project when set of root files has changed (new file on disk)", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: "let x = 1"
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: "let y = 1"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: {} })
            };

            const host = createWatchedSystem([file1, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramActualFiles(watch(), [file1.path]);

            host.reloadFS([file1, file2, configFile]);
            host.checkTimeoutQueueLengthAndRun(1);

            checkProgramActualFiles(watch(), [file1.path, file2.path]);
            checkProgramRootFiles(watch(), [file1.path, file2.path]);
        });

        it("can correctly update configured project when set of root files has changed (new file in list of files)", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: "let x = 1"
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: "let y = 1"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: {}, files: ["f1.ts"] })
            };

            const host = createWatchedSystem([file1, file2, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);

            checkProgramActualFiles(watch(), [file1.path]);

            const modifiedConfigFile = {
                path: configFile.path,
                content: JSON.stringify({ compilerOptions: {}, files: ["f1.ts", "f2.ts"] })
            };

            host.reloadFS([file1, file2, modifiedConfigFile]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [file1.path, file2.path]);
            checkProgramActualFiles(watch(), [file1.path, file2.path]);
        });

        it("can update configured project when set of root files was not changed", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: "let x = 1"
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: "let y = 1"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: {}, files: ["f1.ts", "f2.ts"] })
            };

            const host = createWatchedSystem([file1, file2, configFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);
            checkProgramActualFiles(watch(), [file1.path, file2.path]);

            const modifiedConfigFile = {
                path: configFile.path,
                content: JSON.stringify({ compilerOptions: { outFile: "out.js" }, files: ["f1.ts", "f2.ts"] })
            };

            host.reloadFS([file1, file2, modifiedConfigFile]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramRootFiles(watch(), [file1.path, file2.path]);
            checkProgramActualFiles(watch(), [file1.path, file2.path]);
        });

        it("config file is deleted", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: "let x = 1;"
            };
            const file2 = {
                path: "/a/b/f2.ts",
                content: "let y = 2;"
            };
            const config = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: {} })
            };
            const host = createWatchedSystem([file1, file2, config]);
            const watch = createWatchModeWithConfigFile(config.path, host);

            checkProgramActualFiles(watch(), [file1.path, file2.path]);

            host.clearOutput();
            host.reloadFS([file1, file2]);
            host.checkTimeoutQueueLengthAndRun(1);

            assert.equal(host.exitCode, ExitStatus.DiagnosticsPresent_OutputsSkipped);
            checkOutputContains(host, [`error TS6053: File '${config.path}' not found.${host.newLine}`]);
        });

        it("Proper errors: document is not contained in project", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const corruptedConfig = {
                path: "/a/b/tsconfig.json",
                content: "{"
            };
            const host = createWatchedSystem([file1, corruptedConfig]);
            const watch = createWatchModeWithConfigFile(corruptedConfig.path, host);

            checkProgramActualFiles(watch(), [file1.path]);
        });

        it("correctly handles changes in lib section of config file", () => {
            const libES5 = {
                path: "/compiler/lib.es5.d.ts",
                content: "declare const eval: any"
            };
            const libES2015Promise = {
                path: "/compiler/lib.es2015.promise.d.ts",
                content: "declare class Promise<T> {}"
            };
            const app = {
                path: "/src/app.ts",
                content: "var x: Promise<string>;"
            };
            const config1 = {
                path: "/src/tsconfig.json",
                content: JSON.stringify(
                    {
                        "compilerOptions": {
                            "module": "commonjs",
                            "target": "es5",
                            "noImplicitAny": true,
                            "sourceMap": false,
                            "lib": [
                                "es5"
                            ]
                        }
                    })
            };
            const config2 = {
                path: config1.path,
                content: JSON.stringify(
                    {
                        "compilerOptions": {
                            "module": "commonjs",
                            "target": "es5",
                            "noImplicitAny": true,
                            "sourceMap": false,
                            "lib": [
                                "es5",
                                "es2015.promise"
                            ]
                        }
                    })
            };
            const host = createWatchedSystem([libES5, libES2015Promise, app, config1], { executingFilePath: "/compiler/tsc.js" });
            const watch = createWatchModeWithConfigFile(config1.path, host);

            checkProgramActualFiles(watch(), [libES5.path, app.path]);

            host.reloadFS([libES5, libES2015Promise, app, config2]);
            host.checkTimeoutQueueLengthAndRun(1);
            checkProgramActualFiles(watch(), [libES5.path, libES2015Promise.path, app.path]);
        });

        it("should handle non-existing directories in config file", () => {
            const f = {
                path: "/a/src/app.ts",
                content: "let x = 1;"
            };
            const config = {
                path: "/a/tsconfig.json",
                content: JSON.stringify({
                    compilerOptions: {},
                    include: [
                        "src/**/*",
                        "notexistingfolder/*"
                    ]
                })
            };
            const host = createWatchedSystem([f, config]);
            const watch = createWatchModeWithConfigFile(config.path, host);
            checkProgramActualFiles(watch(), [f.path]);
        });

        it("rename a module file and rename back should restore the states for inferred projects", () => {
            const moduleFile = {
                path: "/a/b/moduleFile.ts",
                content: "export function bar() { };"
            };
            const file1 = {
                path: "/a/b/file1.ts",
                content: "import * as T from './moduleFile'; T.bar();"
            };
            const host = createWatchedSystem([moduleFile, file1, libFile]);
            createWatchModeWithoutConfigFile([file1.path], host);
            const error = "a/b/file1.ts(1,20): error TS2307: Cannot find module \'./moduleFile\'.\n";
            checkOutputDoesNotContain(host, [error]);

            const moduleFileOldPath = moduleFile.path;
            const moduleFileNewPath = "/a/b/moduleFile1.ts";
            moduleFile.path = moduleFileNewPath;
            host.reloadFS([moduleFile, file1, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputContains(host, [error]);

            host.clearOutput();
            moduleFile.path = moduleFileOldPath;
            host.reloadFS([moduleFile, file1, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputDoesNotContain(host, [error]);
        });

        it("rename a module file and rename back should restore the states for configured projects", () => {
            const moduleFile = {
                path: "/a/b/moduleFile.ts",
                content: "export function bar() { };"
            };
            const file1 = {
                path: "/a/b/file1.ts",
                content: "import * as T from './moduleFile'; T.bar();"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{}`
            };
            const host = createWatchedSystem([moduleFile, file1, configFile, libFile]);
            createWatchModeWithConfigFile(configFile.path, host);

            const error = `error TS6053: File '${moduleFile.path}' not found.${host.newLine}`;
            checkOutputDoesNotContain(host, [error]);

            const moduleFileOldPath = moduleFile.path;
            const moduleFileNewPath = "/a/b/moduleFile1.ts";
            moduleFile.path = moduleFileNewPath;
            host.reloadFS([moduleFile, file1, configFile, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputContains(host, [error]);

            host.clearOutput();
            moduleFile.path = moduleFileOldPath;
            host.reloadFS([moduleFile, file1, configFile, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputDoesNotContain(host, [error]);
        });

        it("types should load from config file path if config exists", () => {
            const f1 = {
                path: "/a/b/app.ts",
                content: "let x = 1"
            };
            const config = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: { types: ["node"], typeRoots: [] } })
            };
            const node = {
                path: "/a/b/node_modules/@types/node/index.d.ts",
                content: "declare var process: any"
            };
            const cwd = {
                path: "/a/c"
            };
            const host = createWatchedSystem([f1, config, node, cwd], { currentDirectory: cwd.path });
            const watch = createWatchModeWithConfigFile(config.path, host);

            checkProgramActualFiles(watch(), [f1.path, node.path]);
        });

        it("add the missing module file for inferred project: should remove the `module not found` error", () => {
            const moduleFile = {
                path: "/a/b/moduleFile.ts",
                content: "export function bar() { };"
            };
            const file1 = {
                path: "/a/b/file1.ts",
                content: "import * as T from './moduleFile'; T.bar();"
            };
            const host = createWatchedSystem([file1, libFile]);
            createWatchModeWithoutConfigFile([file1.path], host);

            const error = `a/b/file1.ts(1,20): error TS2307: Cannot find module \'./moduleFile\'.${host.newLine}`;
            checkOutputContains(host, [error]);
            host.clearOutput();

            host.reloadFS([file1, moduleFile, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputDoesNotContain(host, [error]);
        });

        it("Configure file diagnostics events are generated when the config file has errors", () => {
            const file = {
                path: "/a/b/app.ts",
                content: "let x = 10"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{
                        "compilerOptions": {
                            "foo": "bar",
                            "allowJS": true
                        }
                    }`
            };

            const host = createWatchedSystem([file, configFile, libFile]);
            createWatchModeWithConfigFile(configFile.path, host);
            checkOutputContains(host, [
                `a/b/tsconfig.json(3,29): error TS5023: Unknown compiler option \'foo\'.${host.newLine}`,
                `a/b/tsconfig.json(4,29): error TS5023: Unknown compiler option \'allowJS\'.${host.newLine}`
            ]);
        });

        it("Configure file diagnostics events are generated when the config file doesn't have errors", () => {
            const file = {
                path: "/a/b/app.ts",
                content: "let x = 10"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{
                        "compilerOptions": {}
                    }`
            };

            const host = createWatchedSystem([file, configFile, libFile]);
            createWatchModeWithConfigFile(configFile.path, host);
            checkOutputDoesNotContain(host, [
                `a/b/tsconfig.json(3,29): error TS5023: Unknown compiler option \'foo\'.${host.newLine}`,
                `a/b/tsconfig.json(4,29): error TS5023: Unknown compiler option \'allowJS\'.${host.newLine}`
            ]);
        });

        it("Configure file diagnostics events are generated when the config file changes", () => {
            const file = {
                path: "/a/b/app.ts",
                content: "let x = 10"
            };
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{
                        "compilerOptions": {}
                    }`
            };

            const host = createWatchedSystem([file, configFile, libFile]);
            createWatchModeWithConfigFile(configFile.path, host);
            const error = `a/b/tsconfig.json(3,25): error TS5023: Unknown compiler option 'haha'.${host.newLine}`;
            checkOutputDoesNotContain(host, [error]);

            configFile.content = `{
                    "compilerOptions": {
                        "haha": 123
                    }
                }`;
            host.reloadFS([file, configFile, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputContains(host, [error]);

            host.clearOutput();
            configFile.content = `{
                    "compilerOptions": {}
                }`;
            host.reloadFS([file, configFile, libFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputDoesNotContain(host, [error]);
        });

        it("non-existing directories listed in config file input array should be tolerated without crashing the server", () => {
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{
                        "compilerOptions": {},
                        "include": ["app/*", "test/**/*", "something"]
                    }`
            };
            const file1 = {
                path: "/a/b/file1.ts",
                content: "let t = 10;"
            };

            const host = createWatchedSystem([file1, configFile, libFile]);
            const watch = createWatchModeWithConfigFile(configFile.path, host);

            checkProgramActualFiles(watch(), [libFile.path]);
        });

        it("non-existing directories listed in config file input array should be able to handle @types if input file list is empty", () => {
            const f = {
                path: "/a/app.ts",
                content: "let x = 1"
            };
            const config = {
                path: "/a/tsconfig.json",
                content: JSON.stringify({
                    compiler: {},
                    files: []
                })
            };
            const t1 = {
                path: "/a/node_modules/@types/typings/index.d.ts",
                content: `export * from "./lib"`
            };
            const t2 = {
                path: "/a/node_modules/@types/typings/lib.d.ts",
                content: `export const x: number`
            };
            const host = createWatchedSystem([f, config, t1, t2], { currentDirectory: getDirectoryPath(f.path) });
            const watch = createWatchModeWithConfigFile(config.path, host);

            checkProgramActualFiles(watch(), [t1.path, t2.path]);
        });

        it("should support files without extensions", () => {
            const f = {
                path: "/a/compile",
                content: "let x = 1"
            };
            const host = createWatchedSystem([f, libFile]);
            const watch = createWatchModeWithoutConfigFile([f.path], host, { allowNonTsExtensions: true });
            checkProgramActualFiles(watch(), [f.path, libFile.path]);
        });

        it("Options Diagnostic locations reported correctly with changes in configFile contents when options change", () => {
            const file = {
                path: "/a/b/app.ts",
                content: "let x = 10"
            };
            const configFileContentBeforeComment = `{`;
            const configFileContentComment = `
                    // comment
                    // More comment`;
            const configFileContentAfterComment = `
                    "compilerOptions": {
                        "allowJs": true,
                        "declaration": true
                    }
                }`;
            const configFileContentWithComment = configFileContentBeforeComment + configFileContentComment + configFileContentAfterComment;
            const configFileContentWithoutCommentLine = configFileContentBeforeComment + configFileContentAfterComment;

            const line = 5;
            const errors = (line: number) => [
                `a/b/tsconfig.json(${line},25): error TS5053: Option \'allowJs\' cannot be specified with option \'declaration\'.\n`,
                `a/b/tsconfig.json(${line + 1},25): error TS5053: Option \'allowJs\' cannot be specified with option \'declaration\'.\n`
            ];

            const configFile = {
                path: "/a/b/tsconfig.json",
                content: configFileContentWithComment
            };

            const host = createWatchedSystem([file, libFile, configFile]);
            createWatchModeWithConfigFile(configFile.path, host);
            checkOutputContains(host, errors(line));
            checkOutputDoesNotContain(host, errors(line - 2));
            host.clearOutput();

            configFile.content = configFileContentWithoutCommentLine;
            host.reloadFS([file, configFile]);
            host.runQueuedTimeoutCallbacks();
            checkOutputContains(host, errors(line - 2));
            checkOutputDoesNotContain(host, errors(line));
        });
    });

    describe("tsc-watch emit with outFile or out setting", () => {
        function createWatchForOut(out?: string, outFile?: string) {
            const host = createWatchedSystem([]);
            const config: FileOrFolderEmit = {
                path: "/a/tsconfig.json",
                content: JSON.stringify({
                    compilerOptions: { listEmittedFiles: true }
                })
            };

            let getOutput: (file: FileOrFolder) => string;
            if (out) {
                config.content = JSON.stringify({
                    compilerOptions: { listEmittedFiles: true, out }
                });
                getOutput = __ => getEmittedLineForSingleFileOutput(out, host);
            }
            else if (outFile) {
                config.content = JSON.stringify({
                    compilerOptions: { listEmittedFiles: true, outFile }
                });
                getOutput = __ => getEmittedLineForSingleFileOutput(outFile, host);
            }
            else {
                getOutput = file => getEmittedLineForMultiFileOutput(file, host);
            }

            const f1 = getFileOrFolderEmit({
                path: "/a/a.ts",
                content: "let x = 1"
            }, getOutput);
            const f2 = getFileOrFolderEmit({
                path: "/a/b.ts",
                content: "let y = 1"
            }, getOutput);

            const files = [f1, f2, config, libFile];
            host.reloadFS(files);
            createWatchModeWithConfigFile(config.path, host);

            const allEmittedLines = getEmittedLines(files);
            checkOutputContains(host, allEmittedLines);
            host.clearOutput();

            f1.content = "let x = 11";
            host.reloadFS(files);
            host.runQueuedTimeoutCallbacks();
            checkAffectedLines(host, [f1], allEmittedLines);
        }

        it("projectUsesOutFile should not be returned if not set", () => {
            createWatchForOut();
        });

        it("projectUsesOutFile should be true if out is set", () => {
            const outJs = "/a/out.js";
            createWatchForOut(outJs);
        });

        it("projectUsesOutFile should be true if outFile is set", () => {
            const outJs = "/a/out.js";
            createWatchForOut(/*out*/ undefined, outJs);
        });
    });

    describe("tsc-watch emit for configured projects", () => {
        const file1Consumer1Path = "/a/b/file1Consumer1.ts";
        const moduleFile1Path = "/a/b/moduleFile1.ts";
        const configFilePath = "/a/b/tsconfig.json";
        type InitialStateParams = {
            /** custom config file options */
            configObj?: any;
            /** list of the files that will be emitted for first compilation */
            firstCompilationEmitFiles?: string[];
            /** get the emit file for file - default is multi file emit line */
            getEmitLine?(file: FileOrFolder, host: WatchedSystem): string;
            /** Additional files and folders to add */
            getAdditionalFileOrFolder?(): FileOrFolder[];
            /** initial list of files to emit if not the default list */
            firstReloadFileList?: string[];
        };
        function getInitialState({ configObj = {}, firstCompilationEmitFiles, getEmitLine, getAdditionalFileOrFolder, firstReloadFileList }: InitialStateParams = {}) {
            const host = createWatchedSystem([]);
            const getOutputName = getEmitLine ? (file: FileOrFolder) => getEmitLine(file, host) :
                (file: FileOrFolder) => getEmittedLineForMultiFileOutput(file, host);

            const moduleFile1 = getFileOrFolderEmit({
                path: moduleFile1Path,
                content: "export function Foo() { };",
            }, getOutputName);

            const file1Consumer1 = getFileOrFolderEmit({
                path: file1Consumer1Path,
                content: `import {Foo} from "./moduleFile1"; export var y = 10;`,
            }, getOutputName);

            const file1Consumer2 = getFileOrFolderEmit({
                path: "/a/b/file1Consumer2.ts",
                content: `import {Foo} from "./moduleFile1"; let z = 10;`,
            }, getOutputName);

            const moduleFile2 = getFileOrFolderEmit({
                path: "/a/b/moduleFile2.ts",
                content: `export var Foo4 = 10;`,
            }, getOutputName);

            const globalFile3 = getFileOrFolderEmit({
                path: "/a/b/globalFile3.ts",
                content: `interface GlobalFoo { age: number }`
            });

            const additionalFiles = getAdditionalFileOrFolder ?
                map(getAdditionalFileOrFolder(), file => getFileOrFolderEmit(file, getOutputName)) :
                [];

            (configObj.compilerOptions || (configObj.compilerOptions = {})).listEmittedFiles = true;
            const configFile = getFileOrFolderEmit({
                path: configFilePath,
                content: JSON.stringify(configObj)
            });

            const files = [moduleFile1, file1Consumer1, file1Consumer2, globalFile3, moduleFile2, configFile, libFile, ...additionalFiles];
            let allEmittedFiles = getEmittedLines(files);
            host.reloadFS(firstReloadFileList ? getFiles(firstReloadFileList) : files);

            // Initial compile
            createWatchModeWithConfigFile(configFile.path, host);
            if (firstCompilationEmitFiles) {
                checkAffectedLines(host, getFiles(firstCompilationEmitFiles), allEmittedFiles);
            }
            else {
                checkOutputContains(host, allEmittedFiles);
            }
            host.clearOutput();

            return {
                moduleFile1, file1Consumer1, file1Consumer2, moduleFile2, globalFile3, configFile,
                files,
                getFile,
                verifyAffectedFiles,
                verifyAffectedAllFiles,
                getOutputName
            };

            function getFiles(filelist: string[]) {
                return map(filelist, getFile);
            }

            function getFile(fileName: string) {
                return find(files, file => file.path === fileName);
            }

            function verifyAffectedAllFiles() {
                host.reloadFS(files);
                host.checkTimeoutQueueLengthAndRun(1);
                checkOutputContains(host, allEmittedFiles);
                host.clearOutput();
            }

            function verifyAffectedFiles(expected: FileOrFolderEmit[], filesToReload?: FileOrFolderEmit[]) {
                if (!filesToReload) {
                    filesToReload = files;
                }
                else if (filesToReload.length > files.length) {
                    allEmittedFiles = getEmittedLines(filesToReload);
                }
                host.reloadFS(filesToReload);
                host.checkTimeoutQueueLengthAndRun(1);
                checkAffectedLines(host, expected, allEmittedFiles);
                host.clearOutput();
            }
        }

        it("should contains only itself if a module file's shape didn't change, and all files referencing it if its shape changed", () => {
            const {
                moduleFile1, file1Consumer1, file1Consumer2,
                verifyAffectedFiles
            } = getInitialState();

            // Change the content of moduleFile1 to `export var T: number;export function Foo() { };`
            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1, file1Consumer2]);

            // Change the content of moduleFile1 to `export var T: number;export function Foo() { console.log('hi'); };`
            moduleFile1.content = `export var T: number;export function Foo() { console.log('hi'); };`;
            verifyAffectedFiles([moduleFile1]);
        });

        it("should be up-to-date with the reference map changes", () => {
            const {
                moduleFile1, file1Consumer1, file1Consumer2,
                verifyAffectedFiles
            } = getInitialState();

            // Change file1Consumer1 content to `export let y = Foo();`
            file1Consumer1.content = `export let y = Foo();`;
            verifyAffectedFiles([file1Consumer1]);

            // Change the content of moduleFile1 to `export var T: number;export function Foo() { };`
            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer2]);

            // Add the import statements back to file1Consumer1
            file1Consumer1.content = `import {Foo} from "./moduleFile1";let y = Foo();`;
            verifyAffectedFiles([file1Consumer1]);

            // Change the content of moduleFile1 to `export var T: number;export var T2: string;export function Foo() { };`
            moduleFile1.content = `export var T: number;export var T2: string;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer2, file1Consumer1]);

            // Multiple file edits in one go:

            // Change file1Consumer1 content to `export let y = Foo();`
            // Change the content of moduleFile1 to `export var T: number;export function Foo() { };`
            file1Consumer1.content = `export let y = Foo();`;
            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1, file1Consumer2]);
        });

        it("should be up-to-date with deleted files", () => {
            const {
                moduleFile1, file1Consumer1, file1Consumer2,
                files,
                verifyAffectedFiles
            } = getInitialState();

            // Change the content of moduleFile1 to `export var T: number;export function Foo() { };`
            moduleFile1.content = `export var T: number;export function Foo() { };`;

            // Delete file1Consumer2
            const filesToLoad = mapDefined(files, file => file === file1Consumer2 ? undefined : file);
            verifyAffectedFiles([moduleFile1, file1Consumer1], filesToLoad);
        });

        it("should be up-to-date with newly created files", () => {
            const {
                moduleFile1, file1Consumer1, file1Consumer2,
                files,
                verifyAffectedFiles,
                getOutputName
            } = getInitialState();

            const file1Consumer3 = getFileOrFolderEmit({
                path: "/a/b/file1Consumer3.ts",
                content: `import {Foo} from "./moduleFile1"; let y = Foo();`
            }, getOutputName);
            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1, file1Consumer3, file1Consumer2], files.concat(file1Consumer3));
        });

        it("should detect changes in non-root files", () => {
            const {
                moduleFile1, file1Consumer1,
                verifyAffectedFiles
            } = getInitialState({ configObj: { files: [file1Consumer1Path] }, firstCompilationEmitFiles: [file1Consumer1Path, moduleFile1Path] });

            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1]);

            // change file1 internal, and verify only file1 is affected
            moduleFile1.content += "var T1: number;";
            verifyAffectedFiles([moduleFile1]);
        });

        it("should return all files if a global file changed shape", () => {
            const {
                globalFile3, verifyAffectedAllFiles
            } = getInitialState();

            globalFile3.content += "var T2: string;";
            verifyAffectedAllFiles();
        });

        it("should always return the file itself if '--isolatedModules' is specified", () => {
            const {
                moduleFile1, verifyAffectedFiles
            } = getInitialState({ configObj: { compilerOptions: { isolatedModules: true } } });

            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1]);
        });

        it("should always return the file itself if '--out' or '--outFile' is specified", () => {
            const outFilePath = "/a/b/out.js";
            const {
                moduleFile1, verifyAffectedFiles
            } = getInitialState({
                    configObj: { compilerOptions: { module: "system", outFile: outFilePath } },
                    getEmitLine: (_, host) => getEmittedLineForSingleFileOutput(outFilePath, host)
                });

            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1]);
        });

        it("should return cascaded affected file list", () => {
            const file1Consumer1Consumer1: FileOrFolder = {
                path: "/a/b/file1Consumer1Consumer1.ts",
                content: `import {y} from "./file1Consumer1";`
            };
            const {
                moduleFile1, file1Consumer1, file1Consumer2, verifyAffectedFiles, getFile
            } = getInitialState({
                    getAdditionalFileOrFolder: () => [file1Consumer1Consumer1]
                });

            const file1Consumer1Consumer1Emit = getFile(file1Consumer1Consumer1.path);
            file1Consumer1.content += "export var T: number;";
            verifyAffectedFiles([file1Consumer1, file1Consumer1Consumer1Emit]);

            // Doesnt change the shape of file1Consumer1
            moduleFile1.content = `export var T: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1, file1Consumer2]);

            // Change both files before the timeout
            file1Consumer1.content += "export var T2: number;";
            moduleFile1.content = `export var T2: number;export function Foo() { };`;
            verifyAffectedFiles([moduleFile1, file1Consumer1, file1Consumer2, file1Consumer1Consumer1Emit]);
        });

        it("should work fine for files with circular references", () => {
            // TODO: do not exit on such errors? Just continue to watch the files for update in watch mode

            const file1: FileOrFolder = {
                path: "/a/b/file1.ts",
                content: `
                    /// <reference path="./file2.ts" />
                    export var t1 = 10;`
            };
            const file2: FileOrFolder = {
                path: "/a/b/file2.ts",
                content: `
                    /// <reference path="./file1.ts" />
                    export var t2 = 10;`
            };
            const {
                configFile,
                getFile,
                verifyAffectedFiles
            } = getInitialState({
                    firstCompilationEmitFiles: [file1.path, file2.path],
                    getAdditionalFileOrFolder: () => [file1, file2],
                    firstReloadFileList: [libFile.path, file1.path, file2.path, configFilePath]
                });
            const file1Emit = getFile(file1.path), file2Emit = getFile(file2.path);

            file1Emit.content += "export var t3 = 10;";
            verifyAffectedFiles([file1Emit, file2Emit], [file1, file2, libFile, configFile]);

        });

        it("should detect removed code file", () => {
            const referenceFile1: FileOrFolder = {
                path: "/a/b/referenceFile1.ts",
                content: `
                    /// <reference path="./moduleFile1.ts" />
                    export var x = Foo();`
            };
            const {
                configFile,
                getFile,
                verifyAffectedFiles
            } = getInitialState({
                    firstCompilationEmitFiles: [referenceFile1.path, moduleFile1Path],
                    getAdditionalFileOrFolder: () => [referenceFile1],
                    firstReloadFileList: [libFile.path, referenceFile1.path, moduleFile1Path, configFilePath]
                });

            const referenceFile1Emit = getFile(referenceFile1.path);
            verifyAffectedFiles([referenceFile1Emit], [libFile, referenceFile1Emit, configFile]);
        });

        it("should detect non-existing code file", () => {
            const referenceFile1: FileOrFolder = {
                path: "/a/b/referenceFile1.ts",
                content: `
                    /// <reference path="./moduleFile2.ts" />
                    export var x = Foo();`
            };
            const {
                configFile,
                moduleFile2,
                getFile,
                verifyAffectedFiles
            } = getInitialState({
                    firstCompilationEmitFiles: [referenceFile1.path],
                    getAdditionalFileOrFolder: () => [referenceFile1],
                    firstReloadFileList: [libFile.path, referenceFile1.path, configFilePath]
                });

            const referenceFile1Emit = getFile(referenceFile1.path);
            referenceFile1Emit.content += "export var yy = Foo();";
            verifyAffectedFiles([referenceFile1Emit], [libFile, referenceFile1Emit, configFile]);

            // Create module File2 and see both files are saved
            verifyAffectedFiles([referenceFile1Emit, moduleFile2], [libFile, moduleFile2, referenceFile1Emit, configFile]);
        });
    });

    describe("tsc-watch emit file content", () => {
        interface EmittedFile extends FileOrFolder {
            shouldBeWritten: boolean;
        }
        function getEmittedFiles(files: FileOrFolderEmit[], contents: string[]): EmittedFile[] {
            return map(contents, (content, index) => {
                    return {
                        content,
                        path: changeExtension(files[index].path, Extension.Js),
                        shouldBeWritten: true
                    };
                }
            );
        }
        function verifyEmittedFiles(host: WatchedSystem, emittedFiles: EmittedFile[]) {
            for (const { path, content, shouldBeWritten } of emittedFiles) {
                if (shouldBeWritten) {
                    assert.isTrue(host.fileExists(path), `Expected file ${path} to be present`);
                    assert.equal(host.readFile(path), content, `Contents of file ${path} do not match`);
                }
                else {
                    assert.isNotTrue(host.fileExists(path), `Expected file ${path} to be absent`);
                }
            }
        }

        function verifyEmittedFileContents(newLine: string, inputFiles: FileOrFolder[], initialEmittedFileContents: string[],
            modifyFiles: (files: FileOrFolderEmit[], emitedFiles: EmittedFile[]) => FileOrFolderEmit[], configFile?: FileOrFolder) {
            const host = createWatchedSystem([], { newLine });
            const files = concatenate(
                map(inputFiles, file => getFileOrFolderEmit(file, fileToConvert => getEmittedLineForMultiFileOutput(fileToConvert, host))),
                configFile ? [libFile, configFile] : [libFile]
            );
            const allEmittedFiles = getEmittedLines(files);
            host.reloadFS(files);

            // Initial compile
            if (configFile) {
                createWatchModeWithConfigFile(configFile.path, host);
            }
            else {
                // First file as the root
                createWatchModeWithoutConfigFile([files[0].path], host, { listEmittedFiles: true });
            }
            checkOutputContains(host, allEmittedFiles);

            const emittedFiles = getEmittedFiles(files, initialEmittedFileContents);
            verifyEmittedFiles(host, emittedFiles);
            host.clearOutput();

            const affectedFiles = modifyFiles(files, emittedFiles);
            host.reloadFS(files);
            host.checkTimeoutQueueLengthAndRun(1);
            checkAffectedLines(host, affectedFiles, allEmittedFiles);

            verifyEmittedFiles(host, emittedFiles);
        }

        function verifyNewLine(newLine: string) {
            const lines = ["var x = 1;", "var y = 2;"];
            const fileContent = lines.join(newLine);
            const f = {
                path: "/a/app.ts",
                content: fileContent
            };

            verifyEmittedFileContents(newLine, [f], [fileContent + newLine], modifyFiles);

            function modifyFiles(files: FileOrFolderEmit[], emittedFiles: EmittedFile[]) {
                files[0].content = fileContent + newLine + "var z = 3;";
                emittedFiles[0].content = files[0].content + newLine;
                return [files[0]];
            }
        }

        it("handles new lines: \\n", () => {
            verifyNewLine("\n");
        });

        it("handles new lines: \\r\\n", () => {
            verifyNewLine("\r\n");
        });

        it("should emit specified file", () => {
            const file1 = {
                path: "/a/b/f1.ts",
                content: `export function Foo() { return 10; }`
            };

            const file2 = {
                path: "/a/b/f2.ts",
                content: `import {Foo} from "./f1"; export let y = Foo();`
            };

            const file3 = {
                path: "/a/b/f3.ts",
                content: `import {y} from "./f2"; let x = y;`
            };

            const configFile = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ compilerOptions: { listEmittedFiles: true } })
            };

            verifyEmittedFileContents("\r\n", [file1, file2, file3], [
                `"use strict";\r\nexports.__esModule = true;\r\nfunction Foo() { return 10; }\r\nexports.Foo = Foo;\r\n`,
                `"use strict";\r\nexports.__esModule = true;\r\nvar f1_1 = require("./f1");\r\nexports.y = f1_1.Foo();\r\n`,
                `"use strict";\r\nexports.__esModule = true;\r\nvar f2_1 = require("./f2");\r\nvar x = f2_1.y;\r\n`
            ], modifyFiles, configFile);

            function modifyFiles(files: FileOrFolderEmit[], emittedFiles: EmittedFile[]) {
                files[0].content += `export function foo2() { return 2; }`;
                emittedFiles[0].content += `function foo2() { return 2; }\r\nexports.foo2 = foo2;\r\n`;
                emittedFiles[2].shouldBeWritten = false;
                return files.slice(0, 2);
            }
        });
    });
}
