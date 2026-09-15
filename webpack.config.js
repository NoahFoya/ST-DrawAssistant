/**
 * Webpack 构建打包配置文件 (webpack.config.js)
 *
 * 功能：
 * 1. 将插件 TypeScript 源码转译并打包输出为符合 ES 模块规范的浏览器脚本 (dist/index.js)；
 * 2. 配置路径别名与 source-map 调试映射。
 *
 * Tips：
 * 1. 输出模式需配置为 experiments.outputModule，匹配 SillyTavern 原生扩展加载机制；
 * 2. 外部依赖由宿主环境或打包内联处理，构建产物需控制体积。
 */

const path = require('path');

/** @type {import('webpack').Configuration} */
const clientConfig = {
    name: 'client',
    entry: './src/index.ts',
    target: ['web', 'es2020'],
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        clean: true,
        library: {
            type: 'module',
        },
    },
    experiments: {
        outputModule: true,
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
        alias: {
            '@types': path.resolve(__dirname, '@types'),
            '@util': path.resolve(__dirname, 'src/util'),
            '@store': path.resolve(__dirname, 'src/store'),
            '@function': path.resolve(__dirname, 'src/function'),
            '@extension': path.resolve(__dirname, 'src/extension'),
            '@ui': path.resolve(__dirname, 'src/ui'),
            '@config': path.resolve(__dirname, 'config'),
        },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            compilerOptions: {
                                declaration: false,
                                declarationMap: false,
                            },
                        },
                    },
                ],
                exclude: /node_modules/,
            },
        ],
    },
    performance: {
        maxAssetSize: 1048576,
        maxEntrypointSize: 1048576,
    },
};

module.exports = clientConfig;
