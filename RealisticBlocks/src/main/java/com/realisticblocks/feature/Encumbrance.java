package com.realisticblocks.feature;

import com.realisticblocks.config.RBConfig;
import net.minecraft.block.BlockState;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.BlockItem;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;

/**
 * 一整个背包的石头在现实里有几吨重。装太满就走不快。
 * A full inventory of stone weighs tonnes in the real world. Overload yourself and you slow down.
 */
public final class Encumbrance {

    /** 每 20 刻算一次，重量变化没那么快。Recomputed once a second; weight does not change fast. */
    private static final int INTERVAL = 20;

    /** 效果时长要盖过下一次计算。Effect must outlast the next recomputation. */
    private static final int EFFECT_DURATION = INTERVAL * 3;

    private Encumbrance() {
    }

    public static void tick(MinecraftServer server) {
        RBConfig cfg = RBConfig.get();
        if (!cfg.enableEncumbrance) {
            return;
        }
        if (server.getTicks() % INTERVAL != 0) {
            return;
        }
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            if (player.isCreative() || player.isSpectator()) {
                continue;
            }
            double weight = totalWeight(player);
            if (weight <= cfg.weightThreshold) {
                continue;
            }
            int level = (int) ((weight - cfg.weightThreshold) / cfg.weightPerSlownessLevel);
            level = Math.min(level, cfg.maxSlownessLevel);
            player.addStatusEffect(new StatusEffectInstance(
                    StatusEffects.SLOWNESS, EFFECT_DURATION, level, true, false, true));
            player.sendMessage(Text.translatable("message.realisticblocks.overloaded", (int) weight), true);
        }
    }

    private static double totalWeight(ServerPlayerEntity player) {
        ServerWorld world = player.getServerWorld();
        BlockPos pos = player.getBlockPos();
        double total = 0.0D;
        for (int slot = 0; slot < player.getInventory().size(); slot++) {
            total += stackWeight(world, pos, player.getInventory().getStack(slot));
        }
        return total;
    }

    private static double stackWeight(ServerWorld world, BlockPos pos, ItemStack stack) {
        if (stack.isEmpty()) {
            return 0.0D;
        }
        return unitWeight(world, pos, stack) * stack.getCount();
    }

    private static double unitWeight(ServerWorld world, BlockPos pos, ItemStack stack) {
        if (stack.getItem() instanceof BlockItem blockItem) {
            float hardness;
            try {
                BlockState state = blockItem.getBlock().getDefaultState();
                hardness = state.getHardness(world, pos);
            } catch (Exception e) {
                // 少数方块的硬度依赖真实的方块环境，取不到就按普通石头算。
                // A few blocks derive hardness from their surroundings; fall back to plain stone.
                hardness = 1.5F;
            }
            if (hardness < 0.0F) {
                hardness = 10.0F;
            }
            return 0.5D + Math.min(hardness, 8.0F) * 0.75D;
        }
        // 有耐久的都是工具/盔甲一类的硬货。Anything with durability is a tool or armour piece.
        if (stack.getMaxDamage() > 0) {
            return 3.0D;
        }
        return 0.2D;
    }
}
