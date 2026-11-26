/**
 * 核心采样参数复合卡片 (SamplerCard)。
 *
 * @remarks
 * 基于 Preact JSX 为生图提供方（ComfyUI、SD-WebUI/Forge、NovelAI 等）提供核心采样控制：
 * 1. 采样算法 (Sampler) 与调度规则 (Scheduler) 选项列表，自动保留列表中未收录的当前值；
 * 2. 采样步数 (Steps) 与引导系数 (CFG Scale) 数值输入，支持按模型架构动态调整范围；
 * 3. 随机种子 (Seed) 控制器，支持 `-1` 动态随机与固定种子切换。
 */

import type { VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { logger } from '../../util/logger';
import {
    BadgeView,
    ButtonControl,
    CardView,
    FormFieldView,
    NumberInputControl,
    SelectControl,
    TextInputControl,
} from '../framework/controls';
import {
    type RangeConfigItem,
    type SamplerRangeConfig,
    DEFAULT_OFFLINE_SAMPLERS,
    DEFAULT_OFFLINE_SCHEDULERS,
    SD_RANGE_CONFIG,
    FLUX_RANGE_CONFIG,
    NOVELAI_RANGE_CONFIG,
} from '../../domain/provider-specs/samplers';

export {
    type RangeConfigItem,
    type SamplerRangeConfig,
    DEFAULT_OFFLINE_SAMPLERS,
    DEFAULT_OFFLINE_SCHEDULERS,
    SD_RANGE_CONFIG,
    FLUX_RANGE_CONFIG,
    NOVELAI_RANGE_CONFIG,
};

/** 采样算法与调度器动态能力描述 */
export interface SamplerCapabilities {
    /** 支持的采样算法选项列表 */
    readonly samplers: Array<{ value: string; label: string }>;
    /** 支持的调度器选项列表（若后端不支持独立调度器则可为空） */
    readonly schedulers?: Array<{ value: string; label: string }>;
}

/** 采样卡片当前数据状态 */
export interface SamplerCardData {
    /** 采样算法标识 */
    samplerName: string;
    /** 调度规则标识 */
    scheduler?: string;
    /** 采样步数 */
    steps: number;
    /** 提示词引导系数 */
    cfgScale: number;
    /** 随机种子 (-1 为动态随机，正整数为固定种子) */
    seed: number;
}

/** 采样卡片组件属性 */
export interface SamplerCardProps {
    /** 卡片主标题，默认 "采样参数" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 是否作为嵌入组件（不创建外层 Card 边框与标题） */
    embedded?: boolean;
    /** 当前采样参数数据 */
    data?: Partial<SamplerCardData>;
    /** 是否展示调度规则选择框，默认 true */
    showScheduler?: boolean;
    /** 采样算法候选列表 */
    samplers?: Array<{ value: string; label: string }>;
    /** 调度规则候选列表 */
    schedulers?: Array<{ value: string; label: string }>;
    /** 参数范围配置（默认使用 SD 传统配置） */
    rangeConfig?: SamplerRangeConfig;
    /** 是否处于未保存脏状态 */
    dirty?: boolean;
    /** 动态能力拉取处理函数 */
    onFetchCapabilities?: () => Promise<SamplerCapabilities>;
    /** 附加 CSS 类名 */
    className?: string;
    /** 数据变更通知回调 */
    onChange?: (data: SamplerCardData) => void;
}

function mergeOptionWithCurrent(
    base: ReadonlyArray<{ value: string; label: string }>,
    current: string
): Array<{ value: string; label: string }> {
    const list = [...base];
    if (current && !list.some((opt) => opt.value === current)) {
        list.unshift({ value: current, label: current });
    }
    return list;
}

export function SamplerCard(props: SamplerCardProps): VNode {
    const rangeConfig = props.rangeConfig ?? SD_RANGE_CONFIG;
    const stepsCfg = rangeConfig.steps ?? { min: 1, max: 100, step: 1, defaultValue: 25 };
    const cfgScaleCfg = rangeConfig.cfgScale ?? {
        min: 0.0,
        max: 20.0,
        step: 0.1,
        defaultValue: 7.0,
    };

    const resolveFromProps = (): SamplerCardData => ({
        samplerName: props.data?.samplerName ?? 'euler',
        scheduler: props.data?.scheduler ?? 'normal',
        steps: props.data?.steps ?? stepsCfg.defaultValue ?? 25,
        cfgScale: props.data?.cfgScale ?? cfgScaleCfg.defaultValue ?? 7.0,
        seed: props.data?.seed ?? -1,
    });

    const [localData, setLocalData] = useState<SamplerCardData>(() => resolveFromProps());
    const [fetchedSamplers, setFetchedSamplers] = useState<Array<{
        value: string;
        label: string;
    }> | null>(null);
    const [fetchedSchedulers, setFetchedSchedulers] = useState<Array<{
        value: string;
        label: string;
    }> | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const mountedRef = useRef(true);
    const capGenRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            capGenRef.current += 1;
        };
    }, []);

    const propKey = `${props.data?.samplerName ?? ''}:${props.data?.scheduler ?? ''}:${props.data?.steps ?? ''}:${props.data?.cfgScale ?? ''}:${props.data?.seed ?? ''}`;
    const prevPropKeyRef = useRef(propKey);
    useEffect(() => {
        if (prevPropKeyRef.current !== propKey) {
            prevPropKeyRef.current = propKey;
            setLocalData(resolveFromProps());
        }
    }, [propKey]);

    const prevPropsSamplersRef = useRef(props.samplers);
    useEffect(() => {
        if (prevPropsSamplersRef.current !== props.samplers) {
            prevPropsSamplersRef.current = props.samplers;
            setFetchedSamplers(null);
        }
    }, [props.samplers]);

    const prevPropsSchedulersRef = useRef(props.schedulers);
    useEffect(() => {
        if (prevPropsSchedulersRef.current !== props.schedulers) {
            prevPropsSchedulersRef.current = props.schedulers;
            setFetchedSchedulers(null);
        }
    }, [props.schedulers]);

    const baseSamplers =
        fetchedSamplers ??
        (props.samplers && props.samplers.length > 0 ? props.samplers : DEFAULT_OFFLINE_SAMPLERS);
    const baseSchedulers =
        fetchedSchedulers ??
        (props.schedulers && props.schedulers.length > 0
            ? props.schedulers
            : DEFAULT_OFFLINE_SCHEDULERS);

    const samplerOptions = useMemo(
        () => mergeOptionWithCurrent(baseSamplers, localData.samplerName),
        [baseSamplers, localData.samplerName]
    );
    const schedulerOptions = useMemo(
        () => mergeOptionWithCurrent(baseSchedulers, localData.scheduler ?? 'normal'),
        [baseSchedulers, localData.scheduler]
    );

    const updateData = (patch: Partial<SamplerCardData>) => {
        const next: SamplerCardData = { ...localData, ...patch };
        setLocalData(next);
        try {
            props.onChange?.({ ...next });
        } catch (err) {
            logger.error(
                '[SamplerCard] onChange 回调执行异常:',
                err instanceof Error ? err.message : String(err)
            );
        }
    };

    const handleRefreshCapabilities = async () => {
        if (!props.onFetchCapabilities) return;
        const reqGen = ++capGenRef.current;
        setIsRefreshing(true);
        try {
            const res = await props.onFetchCapabilities();
            if (!mountedRef.current || reqGen !== capGenRef.current) return;
            if (res.samplers && res.samplers.length > 0) {
                setFetchedSamplers([...res.samplers]);
            }
            if (res.schedulers && res.schedulers.length > 0) {
                setFetchedSchedulers([...res.schedulers]);
            }
        } catch (err) {
            if (mountedRef.current && reqGen === capGenRef.current) {
                logger.error(
                    '[SamplerCard] 刷新采样能力失败:',
                    err instanceof Error ? err.message : String(err)
                );
            }
        } finally {
            if (mountedRef.current && reqGen === capGenRef.current) {
                setIsRefreshing(false);
            }
        }
    };

    const showScheduler = props.showScheduler ?? true;
    const seedBadgeText = localData.seed === -1 ? '动态随机' : `固定: ${localData.seed}`;
    const seedBadgeVariant = localData.seed === -1 ? 'info' : 'neutral';

    const content = (
        <>
            <FormFieldView
                label="采样算法"
                tooltip="决定去噪迭代算法与成图质感。二次元风格推荐 Euler a、DPM++ 2S a 或 DDIM；写实风格推荐 DPM++ 2M 或 UniPC；Flux 等模型首选 Euler。"
            >
                <SelectControl
                    value={localData.samplerName}
                    options={samplerOptions}
                    onChange={(val) => updateData({ samplerName: val })}
                />
            </FormFieldView>

            {showScheduler && (
                <FormFieldView
                    label="调度器"
                    tooltip="控制去噪过程中的步进时间曲线。Karras 适合细化中后期质感与细节；Normal 与 Simple 过程平稳均衡；SGM Uniform 适配特定扩散模型。通常首选推荐 Karras 或 Normal。"
                >
                    <SelectControl
                        value={localData.scheduler ?? 'normal'}
                        options={schedulerOptions}
                        onChange={(val) => updateData({ scheduler: val })}
                    />
                </FormFieldView>
            )}

            <FormFieldView
                label="采样步数"
                tooltip="画面生成的迭代轮次。步数过低会导致画面模糊且细节未成型，过高则生成耗时倍增且可能引入杂质伪影。推荐区间：SD 1.5 为 20~28 步，SDXL 为 25~35 步，Flux Schnell 仅需 4 步，Flux Dev 为 20~28 步。"
            >
                <NumberInputControl
                    value={localData.steps}
                    min={stepsCfg.min}
                    max={stepsCfg.max}
                    step={stepsCfg.step}
                    precision={0}
                    onChange={(val) => updateData({ steps: Math.round(val) })}
                />
            </FormFieldView>

            <FormFieldView
                label="引导系数 (CFG)"
                tooltip="控制画面贴合提示词的约束程度（CFG Scale）。数值越高越严格遵循提示词，但过高（>9.0）易产生色彩过饱和与肢体崩坏；数值过低画面自由度更高。动漫通常推荐 6.0~7.5，写实推荐 4.5~6.0，Flux / Pony 等专属模型推荐 1.0~3.5。"
            >
                <NumberInputControl
                    value={localData.cfgScale}
                    min={cfgScaleCfg.min}
                    max={cfgScaleCfg.max}
                    step={cfgScaleCfg.step}
                    precision={1}
                    onChange={(val) => updateData({ cfgScale: val })}
                />
            </FormFieldView>

            <FormFieldView
                label="随机种子"
                tooltip="控制生成随机性的种子数。设为 -1 时每次出图自动随机生成；若需微调提示词、测试权重或保持同一角色的构图与容貌一致性，可固定为具体数值。"
            >
                <div className="da-sampler-card__seed-control">
                    <div className="da-sampler-card__seed-input-wrapper">
                        <TextInputControl
                            value={String(localData.seed)}
                            placeholder="-1"
                            onChange={(val) => {
                                const parsed = parseInt(val.trim(), 10);
                                const nextSeed = Number.isNaN(parsed) || parsed < 0 ? -1 : parsed;
                                updateData({ seed: nextSeed });
                            }}
                        />
                    </div>
                    <div className="da-sampler-card__seed-actions">
                        <ButtonControl
                            label="随机新值"
                            variant="secondary"
                            size="sm"
                            tooltip="随机生成一个具体的种子正整数"
                            onClick={() => {
                                const generated = Math.floor(Math.random() * 2147483647) + 1;
                                updateData({ seed: generated });
                            }}
                        />
                        <ButtonControl
                            label="重置 (-1)"
                            variant="secondary"
                            size="sm"
                            tooltip="重置为 -1，每次出图由后端自动随机生成"
                            onClick={() => updateData({ seed: -1 })}
                        />
                    </div>
                </div>
            </FormFieldView>

            {props.onFetchCapabilities && (
                <div className="da-sampler-card__actions-row">
                    <ButtonControl
                        label="刷新可用参数"
                        variant="secondary"
                        size="sm"
                        loading={isRefreshing}
                        onClick={() => void handleRefreshCapabilities()}
                    />
                </div>
            )}
        </>
    );

    if (props.embedded) {
        const cls = [
            'da-sampler-card',
            'da-sampler-card--embedded',
            props.dirty ? 'is-dirty' : '',
            props.className || '',
        ]
            .filter(Boolean)
            .join(' ');
        return <div className={cls}>{content}</div>;
    }

    return (
        <CardView
            title={props.title ?? '采样参数'}
            subtitle={props.subtitle}
            dirty={props.dirty}
            className={props.className}
            badges={<BadgeView text={seedBadgeText} variant={seedBadgeVariant} />}
        >
            {content}
        </CardView>
    );
}
