const path = require('path');

/** @type {import('webpack').Configuration} */
const clientConfig = {
    name: 'client',
    entry: './src/client/index.ts',
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
            '@common': path.resolve(__dirname, 'src/common'),
            '@client': path.resolve(__dirname, 'src/client'),
            '@server': path.resolve(__dirname, 'src/server'),
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

/** @type {import('webpack').Configuration} */
const serverConfig = {
    name: 'server',
    entry: './src/server/index.ts',
    target: 'node',
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'server'),
        filename: 'index.js',
        clean: true,
        library: {
            type: 'commonjs2',
        },
    },
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '@common': path.resolve(__dirname, 'src/common'),
            '@client': path.resolve(__dirname, 'src/client'),
            '@server': path.resolve(__dirname, 'src/server'),
        },
    },
    externals: {
        express: 'commonjs express',
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
};

module.exports = [clientConfig, serverConfig];
