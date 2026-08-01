package com.realisticblocks.physics;

import com.realisticblocks.config.RBConfig;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.FallingBlock;
import net.minecraft.block.FluidBlock;
import net.minecraft.block.PaneBlock;
import net.minecraft.registry.Registries;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;

import java.util.ArrayDeque;

/**
 * 判断一个方块在现实里"站不站得住"。
 * Decides whether a block would realistically stay where it is.
 *
 * <p>规则（依次判定）/ the rules, in order:
 * <ol>
 *   <li>脚下是实心方块 → 撑得住。Solid block underneath → supported.</li>
 *   <li>头顶压着足够厚的岩体 → 靠拱效应自撑（保护天然洞穴不连锁塌方）。
 *       Enough rock stacked overhead → self-supporting arch (keeps caves intact).</li>
 *   <li>沿着实心方块向下 / 水平走，水平步数不超过 maxSupportDistance 能走到满足 1 或 2 的方块
 *       → 撑得住。向下移动不计步数，向上不允许。
 *       A path of solid blocks going sideways/down, costing at most maxSupportDistance horizontal
 *       steps, reaches an anchor. Downward moves are free; upward moves are not allowed.</li>
 *   <li>否则塌。Otherwise it falls.</li>
 * </ol>
 */
public final class StructuralSupport {

    private static final Direction[] HORIZONTAL = {
            Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST
    };

    private StructuralSupport() {
    }

    /** 这个方块是否受本模组重力管辖。Whether this mod's gravity applies to the block at all. */
    public static boolean isAffected(ServerWorld world, BlockPos pos, BlockState state) {
        if (state.isAir()) {
            return false;
        }
        Block block = state.getBlock();
        // 沙砾一类由原版自己处理。Sand & friends already fall on their own.
        if (block instanceof FallingBlock || block instanceof FluidBlock) {
            return false;
        }
        // 基岩、屏障等不可破坏方块。Unbreakable blocks.
        if (state.getHardness(world, pos) < 0.0F) {
            return false;
        }
        // 火把、草、告示牌之类没有碰撞箱的装饰方块由原版的附着规则管。
        // No-collision decoration (torches, grass, signs) keeps vanilla's attachment rules.
        if (state.getCollisionShape(world, pos).isEmpty()) {
            return false;
        }
        RBConfig cfg = RBConfig.get();
        if (!cfg.affectBlockEntities && state.hasBlockEntity()) {
            return false;
        }
        return !cfg.isBlacklisted(Registries.BLOCK.getId(block).toString());
    }

    /** 能不能给别的方块当支撑。Whether this block can carry load for its neighbours. */
    public static boolean isStructural(ServerWorld world, BlockPos pos, BlockState state) {
        if (state.isAir() || state.isReplaceable()) {
            return false;
        }
        if (state.getBlock() instanceof FluidBlock) {
            return false;
        }
        return !state.getCollisionShape(world, pos).isEmpty();
    }

    /** 脆性方块（玻璃等）被压塌时是直接碎掉的。Fragile blocks shatter rather than tumble. */
    public static boolean isFragile(BlockState state) {
        Block block = state.getBlock();
        if (block instanceof PaneBlock) {
            return true;
        }
        String path = Registries.BLOCK.getId(block).getPath();
        return path.contains("glass");
    }

    public static boolean isSupported(ServerWorld world, BlockPos start) {
        RBConfig cfg = RBConfig.get();

        if (isAnchor(world, start, cfg)) {
            return true;
        }
        if (cfg.maxSupportDistance <= 0) {
            return false;
        }

        LongOpenHashSet visited = new LongOpenHashSet();
        visited.add(start.asLong());

        // 0-1 BFS：向下不花代价，水平走一步花 1。
        // 0-1 BFS: downward moves are free, horizontal moves cost one.
        ArrayDeque<Node> queue = new ArrayDeque<>();
        queue.add(new Node(start, 0));

        int budget = cfg.maxSearchNodes;
        while (!queue.isEmpty()) {
            if (visited.size() > budget) {
                // 结构太大，判定不出来就当它撑得住 —— 宁可不塌也不要卡服。
                // Too big to evaluate; assume it holds rather than stalling the server.
                return true;
            }
            Node node = queue.pollFirst();
            if (isAnchor(world, node.pos, cfg)) {
                return true;
            }

            BlockPos down = node.pos.down();
            if (visited.add(down.asLong())) {
                if (!world.getChunkManager().isChunkLoaded(down.getX() >> 4, down.getZ() >> 4)) {
                    return true;
                }
                if (isStructural(world, down, world.getBlockState(down))) {
                    queue.addFirst(new Node(down, node.distance));
                }
            }

            if (node.distance >= cfg.maxSupportDistance) {
                continue;
            }
            for (Direction dir : HORIZONTAL) {
                BlockPos side = node.pos.offset(dir);
                if (!visited.add(side.asLong())) {
                    continue;
                }
                if (!world.getChunkManager().isChunkLoaded(side.getX() >> 4, side.getZ() >> 4)) {
                    return true;
                }
                if (isStructural(world, side, world.getBlockState(side))) {
                    queue.addLast(new Node(side, node.distance + 1));
                }
            }
        }
        return false;
    }

    /** 站在实心地面上，或被足够厚的岩体压住。Resting on solid ground, or buried under enough rock. */
    private static boolean isAnchor(ServerWorld world, BlockPos pos, RBConfig cfg) {
        BlockPos below = pos.down();
        if (below.getY() < world.getBottomY()) {
            return true;
        }
        if (isStructural(world, below, world.getBlockState(below))) {
            return true;
        }
        return hasRockOverhead(world, pos, cfg.selfSupportThickness);
    }

    private static boolean hasRockOverhead(ServerWorld world, BlockPos pos, int thickness) {
        if (thickness <= 0) {
            return false;
        }
        BlockPos.Mutable cursor = pos.mutableCopy();
        int topY = world.getTopY();
        for (int i = 0; i < thickness; i++) {
            cursor.move(Direction.UP);
            if (cursor.getY() >= topY) {
                return false;
            }
            if (!isStructural(world, cursor, world.getBlockState(cursor))) {
                return false;
            }
        }
        return true;
    }

    private record Node(BlockPos pos, int distance) {
    }
}
