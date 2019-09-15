import path from 'path';
import { workspace } from 'vscode';
import { Linter } from 'eslint';
import Fuse from 'fuse.js';
import MissingPluginError from './errors/missingPluginError';
import { npmPackageBaseUrl, eslintRulesUrl, MISSING_URL_URL } from './constants';

const linter = new Linter();
let rules;
let ruleKeys = {};
const pluginsImported = [];
const pluginsBeingImported = new Map();

const fuseOptions = {
    shouldSort: true,
    threshold: 0.3,
    location: 0,
    distance: 10,
    maxPatternLength: 50,
    minMatchCharLength: 1
};

loadAllRules();

function breakOutRuleName(ruleName) {
    let ruleNameParts = ruleName.split('/');

    let scope;
    if (ruleNameParts[0].startsWith('@')) {
        [scope, ...ruleNameParts] = ruleNameParts;
    }

    let plugin;
    if (ruleNameParts.length > 1) {
        [plugin, ...ruleNameParts] = ruleNameParts;
    }

    const key = ruleNameParts.join('/');

    return { scope, plugin, key };
}

function loadAllRules() {
    rules = linter.rules.getAllLoadedRules();
    ruleKeys = Array.from(rules.keys())
        .reduce((ret, item) => {
            const { scope, plugin, key } = breakOutRuleName(item);
            let pluginName = getPluginName(scope, plugin) || 'base';

            ret[pluginName] = ret[pluginName] || [];
            ret[pluginName].push(key);

            return ret;
        }, {});
}

function searchRules(pluginName, key) {
    const list = ruleKeys[pluginName || 'base'] || [];
    const fuse = new Fuse(list, fuseOptions);
    let suggestedRules = fuse.search(key);

    return suggestedRules.map(index => {
        return ((pluginName ? pluginName + '/' : '') + list[index]);
    });
}

function importPlugin(scope, plugin) {
    const pluginName = getPluginName(scope, plugin);

    if (pluginName === '' || pluginsImported.indexOf(pluginName) > -1) {
        return Promise.resolve(pluginName);
    }

    if (pluginsBeingImported.has(pluginName)) {
        return pluginsBeingImported.get(pluginName);
    }

    const pluginPackageName = getPluginPackageName(scope, plugin);
    const packagePattern = `**/node_modules/${pluginPackageName}/package.json`;

    let pluginLoader = workspace.findFiles(packagePattern, null, 1)
        .then(packagePaths => {
            if (packagePaths.length === 0) {
                throw new MissingPluginError(pluginName);
            }

            let dirname = path.dirname(packagePaths[0].path);
            let pluginPackage = __non_webpack_require__(dirname);

            linter.rules.importPlugin(pluginPackage, pluginName);
            pluginsImported.push(pluginName);

            loadAllRules();

            return pluginName;
        }, err => {
            throw err;
        })
        .catch(err => {
            throw err;
        })
        .then(pluginName => {
            pluginsBeingImported.delete(pluginName);
            return pluginName;
        });

    pluginsBeingImported.set(pluginName, pluginLoader);

    return pluginLoader;
}

export function getRuleDetails(ruleName) {
    const { scope, plugin, key } = breakOutRuleName(ruleName);

    const pluginPackageName = getPluginPackageName(scope, plugin);

    const pluginUrl = `${npmPackageBaseUrl}${pluginPackageName}`;

    return importPlugin(scope, plugin)
        .then(pluginName => {
            if (!rules.has(ruleName)) {
                return {
                    ruleName,
                    pluginName,
                    isRuleFound: false,
                    suggestedRules: searchRules(pluginName, key),
                    isPluginMissing: false,
                    infoUrl: pluginName ? pluginUrl : eslintRulesUrl,
                    infoPageTitle: pluginName ? pluginPackageName : 'eslint rules'
                };
            }

            let ruleInfo = rules.get(ruleName);
            let ruleMeta = ruleInfo.meta || {};
            let ruleDocs = ruleMeta.docs || {};

            return {
                ruleName,
                pluginName,
                isRuleFound: true,
                isPluginMissing: false,
                infoUrl: ruleDocs.url || (pluginName ? MISSING_URL_URL : eslintRulesUrl),
                infoPageTitle: ruleName,
                category: ruleDocs.category,
                isRecommended: ruleDocs.recommended,
                isFixable: ruleMeta.fixable ? true : false,
                isDeprecated: ruleMeta.deprecated ? true : false,
                replacedBy: ruleDocs.replacedBy,
                description: ruleDocs.description
            };
        }, err => {
            if (err.name === 'MissingPluginError') {
                return {
                    ruleName,
                    pluginName: getPluginName(scope, plugin),
                    isRuleFound: false,
                    isPluginMissing: true,
                    infoUrl: pluginUrl,
                    pluginPackageName,
                    infoPageTitle: pluginPackageName
                };
            }
        });
}

function getPluginName(scope, plugin) {
    return [scope, plugin].filter(x => x !== undefined).join('/');
}

function getPluginPackageName(scope, plugin) {
    const scopePath = scope ? `${scope}/` : '';
    const pluginPath = plugin ? `-${plugin}` : '';
    return `${scopePath}eslint-plugin${pluginPath}`;
}