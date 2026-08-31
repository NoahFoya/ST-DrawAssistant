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
            '@function': path.resolve(__dirname, 'src/function'),
            '@panel': path.resolve(__dirname, 'src/panel'),
            '@store': path.resolve(__dirname, 'src/store'),
            '@util': path.resolve(__dirname, 'src/util'),
            '@slash': path.resolve(__dirname, 'src/slash_command'),
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
