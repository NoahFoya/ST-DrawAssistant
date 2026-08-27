// webpack.config.js
const path = require('path');
const fs = require('fs');

/**
 * 自定义 Webpack 插件：将 src/config/ 配置文件同步复制至 dist/config/，并自动扫描子目录生成 manifest.json 索引文件
 */
class GeneratePresetManifestPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('GeneratePresetManifestPlugin', () => {
            const srcConfigDir = path.resolve(__dirname, 'src/config');
            const distConfigDir = path.resolve(__dirname, 'dist/config');
            const srcPresetsDir = path.resolve(__dirname, 'src/config/presets');
            const distPresetsDir = path.resolve(__dirname, 'dist/config/presets');

            if (!fs.existsSync(srcConfigDir)) return;

            // 1. 将 src/config/ 目录完整递归复制到 dist/config/
            fs.mkdirSync(distConfigDir, { recursive: true });
            fs.cpSync(srcConfigDir, distConfigDir, { recursive: true });

            // 2. 动态扫描 presets 目录下所有预设子目录，自动生成 manifest.json
            const manifest = {};
            if (fs.existsSync(srcPresetsDir)) {
                const subDirs = fs.readdirSync(srcPresetsDir, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                subDirs.forEach(subDir => {
                    const fullSubDir = path.join(srcPresetsDir, subDir);
                    manifest[subDir] = fs.readdirSync(fullSubDir).filter(f => f.endsWith('.json'));
                });
            }

            fs.writeFileSync(path.join(distPresetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        });
    }
}

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
    plugins: [
        new GeneratePresetManifestPlugin(),
    ],
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
