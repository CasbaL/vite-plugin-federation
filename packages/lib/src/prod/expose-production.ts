// *****************************************************************************
// Copyright (C) 2022 Origin.js and others.
//
// This program and the accompanying materials are licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//          http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
// EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
// MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.
//
// SPDX-License-Identifier: MulanPSL-2.0
// *****************************************************************************

import { resolve, parse, basename, extname, relative, dirname } from 'path'
import {
  getModuleMarker,
  normalizePath,
  parseExposeOptions,
  removeNonRegLetter,
  NAME_CHAR_REG
} from '../utils'
import {
  builderInfo,
  DYNAMIC_LOADING_CSS,
  DYNAMIC_LOADING_CSS_PREFIX,
  EXPOSES_MAP,
  EXPOSES_KEY_MAP,
  EXTERNALS,
  parsedOptions,
  SHARED,
  viteConfigResolved
} from '../public'
import type { AcornNode, OutputAsset, OutputChunk } from 'rollup'
import type { VitePluginFederationOptions } from 'types'
import type { PluginHooks } from '../../types/pluginHooks'
import MagicString from 'magic-string'
import { walk } from 'estree-walker'
import type { ResolvedConfig } from 'vite'

export function prodExposePlugin(
  options: VitePluginFederationOptions
): PluginHooks {
  let moduleMap = ''
  const hasOptions = parsedOptions.prodExpose.some((expose) => {
    return expose[0] === parseExposeOptions(options)[0]?.[0]
  })
  if (!hasOptions) {
    parsedOptions.prodExpose = Array.prototype.concat(
      parsedOptions.prodExpose,
      parseExposeOptions(options)
    )
  }
  // exposes module
  for (const item of parseExposeOptions(options)) {
    const moduleName = getModuleMarker(`\${${item[0]}}`, SHARED)
    EXTERNALS.push(moduleName)
    const exposeFilepath = normalizePath(resolve(item[1].import))
    EXPOSES_MAP.set(item[0], exposeFilepath)
    EXPOSES_KEY_MAP.set(
      item[0],
      `__federation_expose_${removeNonRegLetter(item[0], NAME_CHAR_REG)}`
    )
    moduleMap += `\n"${item[0]}":()=>{
      ${DYNAMIC_LOADING_CSS}('${DYNAMIC_LOADING_CSS_PREFIX}${exposeFilepath}', ${item[1].dontAppendStylesToHead}, '${item[0]}')
      return __federation_import('\${__federation_expose_${item[0]}}').then(module =>Object.keys(module).every(item => exportSet.has(item)) ? () => module.default : () => module)},`
  }

  // let viteConfigResolved: ResolvedConfig

  return {
    name: 'originjs:expose-production',
    virtualFile: {
      // code generated for remote
      // language=JS
      [`__remoteEntryHelper__${options.filename}`]: `
      const currentImports = {}
      const exportSet = new Set(['Module', '__esModule', 'default', '_export_sfc']);
      let moduleMap = {${moduleMap}}
      const seen = {}
      export const ${DYNAMIC_LOADING_CSS} = (cssFilePaths, dontAppendStylesToHead, exposeItemName) => {
        const metaUrl = import.meta.url;
        if (typeof metaUrl === 'undefined') {
          console.warn('The remote style takes effect only when the build.target option in the vite.config.ts file is higher than that of "es2020".');
          return;
        }

        const curUrl = metaUrl.substring(0, metaUrl.lastIndexOf('${options.filename}'));
        const base = __VITE_BASE_PLACEHOLDER__;
        const assetsDir = __VITE_ASSETS_DIR_PLACEHOLDER__;

        cssFilePaths.forEach(cssPath => {
         let href = '';
         const baseUrl = base || curUrl;
         if (baseUrl) {
           const trimmer = {
             trailing: (path) => (path.endsWith('/') ? path.slice(0, -1) : path),
             leading: (path) => (path.startsWith('/') ? path.slice(1) : path)
           }
           const isAbsoluteUrl = (url) => url.startsWith('http') || url.startsWith('//');

           const cleanBaseUrl = trimmer.trailing(baseUrl).replace('.', '');
           const cleanAssetsDir = trimmer.leading(assetsDir);
           const cleanCssPath = trimmer.leading(cssPath);
           const cleanCurUrl = trimmer.trailing(curUrl);

           if (isAbsoluteUrl(baseUrl)) {
             href = [cleanBaseUrl, cleanAssetsDir, cleanCssPath].filter(Boolean).join('/');
           } else {
            if (cleanCurUrl.includes(cleanBaseUrl)) {
              href = [cleanCurUrl, cleanAssetsDir, cleanCssPath].filter(Boolean).join('/');
            } else {
              href = [cleanCurUrl + cleanBaseUrl, cleanAssetsDir, cleanCssPath].filter(Boolean).join('/');
            }
           }
         } else {
           href = cssPath;
         }
         
          if (dontAppendStylesToHead) {
            const key = 'css__${options.name}__' + exposeItemName;
            window[key] = window[key] || [];
            window[key].push(href);
            return;
          }

          if (href in seen) return;
          seen[href] = true;

          const element = document.createElement('link');
          element.rel = 'stylesheet';
          element.href = href;
          document.head.appendChild(element);
        });
      };
      async function __federation_import(name) {
        currentImports[name] ??= import(name)
        return currentImports[name]
      };
      export const get =(module) => {
        if(!moduleMap[module]) throw new Error('Can not find remote module ' + module)
        return moduleMap[module]();
      };
      export const init =(shareScope) => {
        globalThis.__federation_shared__= globalThis.__federation_shared__|| {};
        Object.entries(shareScope).forEach(([key, value]) => {
          for (const [versionKey, versionValue] of Object.entries(value)) {
            const scope = versionValue.scope || 'default'
            globalThis.__federation_shared__[scope] = globalThis.__federation_shared__[scope] || {};
            const shared= globalThis.__federation_shared__[scope];
            (shared[key] = shared[key]||{})[versionKey] = versionValue;
          }
        });
      }`
    },

    configResolved(config: ResolvedConfig) {
      if (config) {
        viteConfigResolved.config = config
      }
    },

    buildStart() {
      // if we don't expose any modules, there is no need to emit file
      if (parsedOptions.prodExpose.length > 0) {
        this.emitFile({
          fileName: `${
            builderInfo.assetsDir ? builderInfo.assetsDir + '/' : ''
          }${options.filename}`,
          type: 'chunk',
          id: `__remoteEntryHelper__${options.filename}`,
          preserveSignature: 'strict'
        })
      }
    },

    generateBundle(_options, bundle) {
      // replace import absolute path to chunk's fileName in remoteEntry.js
      let remoteEntryChunk
      for (const file in bundle) {
        const chunk = bundle[file] as OutputChunk
        if (
          chunk?.facadeModuleId ===
          `\0virtual:__remoteEntryHelper__${options.filename}`
        ) {
          remoteEntryChunk = chunk
          break
        }
      }
      // placeholder replace
      if (remoteEntryChunk) {
        // 替换 base 和 assetsDir 占位符
        remoteEntryChunk.code = remoteEntryChunk.code
          .replace(
            '__VITE_BASE_PLACEHOLDER__',
            `'${viteConfigResolved.config?.base || ''}'`
          )
          .replace(
            '__VITE_ASSETS_DIR_PLACEHOLDER__',
            `'${viteConfigResolved.config?.build?.assetsDir || 'assets'}'`
          )

        const filepathMap = new Map()
        const getFilename = (name) => parse(parse(name).name).name
        const cssBundlesMap: Map<string, OutputAsset | OutputChunk> =
          Object.keys(bundle)
            .filter((name) => extname(name) === '.css')
            .reduce((res, name) => {
              const filename = getFilename(name)
              res.set(filename, bundle[name])
              return res
            }, new Map())
        remoteEntryChunk.code = remoteEntryChunk.code.replace(
          new RegExp(`(["'])${DYNAMIC_LOADING_CSS_PREFIX}.*?\\1`, 'g'),
          (str) => {
            // when build.cssCodeSplit: false, all files are aggregated into style.xxxxxxxx.css
            if (
              viteConfigResolved.config &&
              !viteConfigResolved.config.build.cssCodeSplit
            ) {
              if (cssBundlesMap.size) {
                return `[${[...cssBundlesMap.values()]
                  .map((cssBundle) =>
                    JSON.stringify(basename(cssBundle.fileName))
                  )
                  .join(',')}]`
              } else {
                return '[]'
              }
            }
            const filepath = str.slice(
              (`'` + DYNAMIC_LOADING_CSS_PREFIX).length,
              -1
            )
            if (!filepath || !filepath.length) return str
            let fileBundle = filepathMap.get(filepath)
            if (!fileBundle) {
              fileBundle = Object.values(bundle).find(
                (b) => 'facadeModuleId' in b && b.facadeModuleId === filepath
              )
              if (fileBundle) filepathMap.set(filepath, fileBundle)
              else return str
            }
            const depCssFiles: Set<string> = new Set()
            const addDepCss = (bundleName) => {
              const theBundle = bundle[bundleName] as any
              if (theBundle && theBundle.viteMetadata) {
                for (const cssFileName of theBundle.viteMetadata.importedCss.values()) {
                  const cssBundle = cssBundlesMap.get(getFilename(cssFileName))
                  if (cssBundle) {
                    depCssFiles.add(cssBundle.fileName)
                  }
                }
              }
              if (theBundle && theBundle.imports && theBundle.imports.length) {
                theBundle.imports.forEach((name) => addDepCss(name))
              }
            }

            ;[fileBundle.fileName, ...fileBundle.imports].forEach(addDepCss)

            return `[${[...depCssFiles]
              .map((d) => JSON.stringify(basename(d)))
              .join(',')}]`
          }
        )

        // replace the export file placeholder path to final chunk path
        for (const expose of parseExposeOptions(options)) {
          const module = Object.keys(bundle).find((module) => {
            const chunk = bundle[module]
            return chunk.name === EXPOSES_KEY_MAP.get(expose[0])
          })

          if (module) {
            const chunk = bundle[module]
            const fileRelativePath = relative(
              dirname(remoteEntryChunk.fileName),
              chunk.fileName
            )
            const slashPath = fileRelativePath.replace(/\\/g, '/')
            remoteEntryChunk.code = remoteEntryChunk.code.replace(
              `\${__federation_expose_${expose[0]}}`,
              viteConfigResolved.config?.base?.replace(/\/+$/, '')
                ? [
                    viteConfigResolved.config.base.replace(/\/+$/, ''),
                    viteConfigResolved.config.build?.assetsDir?.replace(
                      /\/+$/,
                      ''
                    ),
                    slashPath
                  ]
                    .filter(Boolean)
                    .join('/')
                : `./${slashPath}`
            )
          }
        }

        // remove all __f__dynamic_loading_css__ after replace
        let ast: AcornNode | null = null
        try {
          ast = this.parse(remoteEntryChunk.code)
        } catch (err) {
          console.error(err)
        }
        if (!ast) {
          return
        }
        const magicString = new MagicString(remoteEntryChunk.code)
        // let cssFunctionName: string = DYNAMIC_LOADING_CSS
        walk(ast, {
          enter(node: any) {
            if (
              node &&
              node.type === 'CallExpression' &&
              typeof node.arguments[0]?.value === 'string' &&
              node.arguments[0]?.value.indexOf(
                `${DYNAMIC_LOADING_CSS_PREFIX}`
              ) > -1
            ) {
              magicString.remove(node.start, node.end + 1)
            }
          }
        })
        remoteEntryChunk.code = magicString.toString()
      }
    }
  }
}
