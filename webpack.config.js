/**
 * Webpack 构建打包配置。
 *
 * 将插件 TypeScript 源码转译并打包输出为符合 ES 模块规范的浏览器脚本 (dist/index.js)。
 * 配置 experiments.outputModule 以匹配 SillyTavern 原生扩展动态加载机制。
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
            '@pipeline': path.resolve(__dirname, 'src/pipeline'),
            '@provider': path.resolve(__dirname, 'src/provider'),
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
