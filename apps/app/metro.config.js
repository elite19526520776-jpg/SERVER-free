// Metro 在 monorepo 下的配置：需要显式告诉它去仓库根目录找 workspace 包，
// 否则 `@chat/shared` 无法被解析。
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// workspace 里两处 node_modules 都可能有 react，禁用 hierarchical lookup 可避免装两份 React
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
