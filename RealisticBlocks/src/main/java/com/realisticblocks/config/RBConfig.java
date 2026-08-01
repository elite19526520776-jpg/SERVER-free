package com.realisticblocks.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.realisticblocks.RealisticBlocks;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 所有玩法开关都集中在这里，写到 config/realisticblocks.json。
 * All gameplay knobs live here and are persisted to config/realisticblocks.json.
 */
public class RBConfig {

    // ---------------------------------------------------------------- 重力 / gravity

    /** 方块失去支撑时会坍塌。Blocks collapse once they lose structural support. */
    public boolean enableGravity = true;

    /** 距离最近支撑点的最大水平格数，超过就塌。Max horizontal steps to an anchor before a block falls. */
    public int maxSupportDistance = 6;

    /**
     * 头顶累计这么多格实心方块时视为"厚岩体"，靠自身拱效应稳住 —— 这条规则让天然洞穴、
     * 矿道顶部不会连锁塌方。设为 0 可关闭。
     * A block with at least this much solid rock stacked above it is treated as a self-supporting
     * mass (arching). Keeps natural caves and mineshafts from chain-collapsing. 0 disables.
     */
    public int selfSupportThickness = 3;

    /** 坍塌前的延迟刻数，给你时间补一根柱子。Ticks of grace before a block actually falls. */
    public int collapseDelayTicks = 4;

    /** 含方块实体的方块（箱子/熔炉等）是否受重力影响。Whether blocks with block entities fall too. */
    public boolean affectBlockEntities = false;

    /** 玻璃一类的脆性方块直接碎掉而不是掉落。Fragile blocks (glass) shatter instead of falling. */
    public boolean shatterFragileBlocks = true;

    /** 下落方块砸到实体会造成伤害。Falling blocks hurt entities they land on. */
    public boolean fallingBlocksHurt = true;

    /** 每格下落高度的伤害。Damage per block fallen. */
    public float fallDamagePerBlock = 2.0F;

    /** 单次砸落的伤害上限。Damage cap for one impact. */
    public int maxFallDamage = 40;

    /** 永远不会坍塌的方块 ID。Block IDs that never collapse. */
    public List<String> gravityBlacklist = new ArrayList<>(List.of(
            "minecraft:bedrock",
            "minecraft:barrier",
            "minecraft:command_block",
            "minecraft:structure_block",
            "minecraft:end_portal_frame",
            "minecraft:obsidian",
            "minecraft:crying_obsidian",
            "minecraft:respawn_anchor",
            "minecraft:reinforced_deepslate"
    ));

    // ------------------------------------------------------------- 性能 / performance

    /** 每刻每个维度最多做多少次支撑判定。Support checks per world tick. */
    public int maxChecksPerTick = 256;

    /** 每刻每个维度最多坍塌多少个方块。Collapses per world tick. */
    public int maxCollapsesPerTick = 64;

    /** 单次支撑搜索访问的最大节点数。Node budget for one support search. */
    public int maxSearchNodes = 512;

    /** 待检查队列的上限，防止爆炸时堆积。Hard cap on the pending-check queue. */
    public int maxQueueSize = 20000;

    // --------------------------------------------------------------- 采掘 / mining

    /** 没有合适工具就完全挖不动（而不是只是不掉落）。Wrong tool means you simply cannot break it. */
    public boolean requireProperTools = true;

    /** 徒手硬凿石头会擦伤自己。Punching stone barehanded hurts you. */
    public boolean handMiningHurts = true;

    /** 徒手凿击的伤害。Damage dealt by a barehanded swing at rock. */
    public float handMiningDamage = 1.0F;

    // ------------------------------------------------------------ 负重 / encumbrance

    /** 背包太重会拖慢移动。Heavy inventories slow you down. */
    public boolean enableEncumbrance = true;

    /** 开始拖慢的重量阈值。Weight at which you start slowing down. */
    public double weightThreshold = 220.0D;

    /** 每超出这么多重量增加一级缓慢。Extra weight per additional slowness level. */
    public double weightPerSlownessLevel = 110.0D;

    /** 缓慢等级上限。Cap on the slowness amplifier. */
    public int maxSlownessLevel = 3;

    // ------------------------------------------------------------------ 运行时 / runtime

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static RBConfig instance = new RBConfig();
    private transient Set<String> blacklistCache;

    public static RBConfig get() {
        return instance;
    }

    public boolean isBlacklisted(String blockId) {
        Set<String> cache = blacklistCache;
        if (cache == null) {
            cache = new HashSet<>(gravityBlacklist);
            blacklistCache = cache;
        }
        return cache.contains(blockId);
    }

    private static Path path() {
        return FabricLoader.getInstance().getConfigDir().resolve(RealisticBlocks.MOD_ID + ".json");
    }

    /** 读取配置，文件缺失或损坏时回退到默认值并重写。Load config, rewriting defaults if missing/corrupt. */
    public static void load() {
        Path file = path();
        if (Files.exists(file)) {
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                RBConfig loaded = GSON.fromJson(reader, RBConfig.class);
                if (loaded != null) {
                    loaded.clamp();
                    instance = loaded;
                    RealisticBlocks.LOGGER.info("Loaded config from {}", file);
                    return;
                }
            } catch (Exception e) {
                RealisticBlocks.LOGGER.error("Could not read {}, falling back to defaults", file, e);
            }
        }
        instance = new RBConfig();
        save();
    }

    public static void save() {
        Path file = path();
        try {
            Files.createDirectories(file.getParent());
            try (Writer writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                GSON.toJson(instance, writer);
            }
        } catch (IOException e) {
            RealisticBlocks.LOGGER.error("Could not write {}", file, e);
        }
    }

    /** 把手改坏的数值拉回安全范围。Pull hand-edited values back into a sane range. */
    private void clamp() {
        maxSupportDistance = Math.max(0, Math.min(maxSupportDistance, 32));
        selfSupportThickness = Math.max(0, Math.min(selfSupportThickness, 64));
        collapseDelayTicks = Math.max(0, Math.min(collapseDelayTicks, 200));
        maxChecksPerTick = Math.max(1, Math.min(maxChecksPerTick, 8192));
        maxCollapsesPerTick = Math.max(1, Math.min(maxCollapsesPerTick, 1024));
        maxSearchNodes = Math.max(8, Math.min(maxSearchNodes, 16384));
        maxQueueSize = Math.max(64, Math.min(maxQueueSize, 500000));
        fallDamagePerBlock = Math.max(0.0F, fallDamagePerBlock);
        maxFallDamage = Math.max(0, maxFallDamage);
        handMiningDamage = Math.max(0.0F, handMiningDamage);
        weightThreshold = Math.max(1.0D, weightThreshold);
        weightPerSlownessLevel = Math.max(1.0D, weightPerSlownessLevel);
        maxSlownessLevel = Math.max(0, Math.min(maxSlownessLevel, 9));
        if (gravityBlacklist == null) {
            gravityBlacklist = new ArrayList<>();
        }
        blacklistCache = null;
    }
}
