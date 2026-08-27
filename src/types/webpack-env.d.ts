/**
 * @module types/webpack-env
 * @description Webpack 资源加载器类型补充声明
 */
interface WebpackContext {
    keys(): string[];
    <T = unknown>(id: string): T;
    resolve(id: string): string;
    id: string;
}

declare const require: {
    context: (
        directory: string,
        useSubdirectories?: boolean,
        regExp?: RegExp
    ) => WebpackContext;
};
