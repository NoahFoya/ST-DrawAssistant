// webpack.config.js
const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        // 不使用模块系统，直接作为脚本执行（SillyTavern 用 import() 加载）
        library: {
            type: 'module',
        },
    },
    experiments: {
        outputModule: true,
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        // 生产构建时报告类型错误；开发模式下可加速
                        transpileOnly: false,
                    },
                },
                exclude: /node_modules/,
            },
        ],
    },
    // SillyTavern 全局对象作为外部依赖，不打包进 bundle
    externals: {
        // 如果未来需要引用宿主暴露的模块，在此声明
    },
    // source map 在开发模式自动启用，生产模式禁用
    devtool: process.env.NODE_ENV === 'development' ? 'source-map' : false,
};
