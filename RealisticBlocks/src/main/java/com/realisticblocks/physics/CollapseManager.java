package com.realisticblocks.physics;

import com.realisticblocks.config.RBConfig;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import net.minecraft.block.BlockState;
import net.minecraft.entity.FallingBlockEntity;
import net.minecraft.particle.BlockStateParticleEffect;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;

import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 每个维度一个实例，收集"周围发生过变化"的坐标，按预算逐刻检查并让失去支撑的方块塌下去。
 * One instance per dimension. Collects positions whose neighbourhood changed and, within a
 * per-tick budget, drops whatever lost its support.
 */
public final class CollapseManager {

    private static final Map<ServerWorld, CollapseManager> INSTANCES = new ConcurrentHashMap<>();

    private final ServerWorld world;
    private final ArrayDeque<Pending> queue = new ArrayDeque<>();
    private final LongOpenHashSet queued = new LongOpenHashSet();
    private long tick;

    private CollapseManager(ServerWorld world) {
        this.world = world;
    }

    public static void create(ServerWorld world) {
        INSTANCES.put(world, new CollapseManager(world));
    }

    public static void remove(ServerWorld world) {
        INSTANCES.remove(world);
    }

    public static CollapseManager get(ServerWorld world) {
        return INSTANCES.get(world);
    }

    /** 把坐标本身和邻居排进待检查队列。Queue a position and its neighbours for a support check. */
    public void onBlockChanged(BlockPos pos) {
        if (!RBConfig.get().enableGravity) {
            return;
        }
        schedule(pos.asLong());
        for (Direction dir : Direction.values()) {
            schedule(pos.offset(dir).asLong());
        }
        // 斜上方的方块也可能因为这次变化悬空。Diagonals above can be undermined by the same change.
        BlockPos up = pos.up();
        for (Direction dir : Direction.Type.HORIZONTAL) {
            schedule(up.offset(dir).asLong());
        }
    }

    private void schedule(long packed) {
        RBConfig cfg = RBConfig.get();
        if (queue.size() >= cfg.maxQueueSize) {
            return;
        }
        if (queued.add(packed)) {
            queue.addLast(new Pending(packed, tick + cfg.collapseDelayTicks));
        }
    }

    public void tick() {
        tick++;
        RBConfig cfg = RBConfig.get();
        if (!cfg.enableGravity) {
            if (!queue.isEmpty()) {
                queue.clear();
                queued.clear();
            }
            return;
        }

        int checks = 0;
        int collapses = 0;
        while (!queue.isEmpty() && checks < cfg.maxChecksPerTick && collapses < cfg.maxCollapsesPerTick) {
            // collapseDelayTicks 是常量，所以队列本身就是按到期时间排好的。
            // collapseDelayTicks is constant, so the queue is already ordered by due time.
            Pending pending = queue.peekFirst();
            if (pending.dueTick > tick) {
                break;
            }
            queue.pollFirst();
            queued.remove(pending.pos);
            checks++;

            BlockPos pos = BlockPos.fromLong(pending.pos);
            if (!world.getChunkManager().isChunkLoaded(pos.getX() >> 4, pos.getZ() >> 4)) {
                continue;
            }
            BlockState state = world.getBlockState(pos);
            if (!StructuralSupport.isAffected(world, pos, state)) {
                continue;
            }
            if (StructuralSupport.isSupported(world, pos)) {
                continue;
            }
            if (collapse(pos, state, cfg)) {
                collapses++;
                // 塌完再看一圈邻居，形成连锁。Re-check neighbours so collapses cascade.
                onBlockChanged(pos);
            }
        }
    }

    private boolean collapse(BlockPos pos, BlockState state, RBConfig cfg) {
        playCollapseEffects(pos, state);

        if (cfg.shatterFragileBlocks && StructuralSupport.isFragile(state)) {
            // 玻璃摔不成一块完整的玻璃。Glass does not survive the drop.
            return world.breakBlock(pos, false);
        }

        FallingBlockEntity falling = FallingBlockEntity.spawnFromBlock(world, pos, state);
        if (falling == null) {
            return false;
        }
        falling.dropItem = true;
        if (cfg.fallingBlocksHurt) {
            falling.setHurtEntities(cfg.fallDamagePerBlock, cfg.maxFallDamage);
        }
        return true;
    }

    private void playCollapseEffects(BlockPos pos, BlockState state) {
        world.playSound(null, pos, state.getSoundGroup().getBreakSound(), SoundCategory.BLOCKS, 0.55F, 0.85F);
        world.spawnParticles(
                new BlockStateParticleEffect(ParticleTypes.BLOCK, state),
                pos.getX() + 0.5D, pos.getY() + 0.5D, pos.getZ() + 0.5D,
                8, 0.3D, 0.3D, 0.3D, 0.0D);
    }

    public int pendingCount() {
        return queue.size();
    }

    private record Pending(long pos, long dueTick) {
    }
}
