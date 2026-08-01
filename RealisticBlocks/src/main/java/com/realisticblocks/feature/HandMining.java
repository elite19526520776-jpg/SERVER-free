package com.realisticblocks.feature;

import com.realisticblocks.config.RBConfig;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;
import org.jetbrains.annotations.Nullable;

/**
 * 现实里徒手是抠不开一块花岗岩的 —— 没有合适的工具就根本挖不动，硬凿还会伤到手。
 * You cannot claw granite apart with bare hands. Without the right tool the block simply does not
 * break, and swinging at it hurts.
 */
public final class HandMining {

    private HandMining() {
    }

    public static boolean beforeBreak(World world, PlayerEntity player, BlockPos pos, BlockState state,
                                      @Nullable BlockEntity blockEntity) {
        RBConfig cfg = RBConfig.get();
        if (!cfg.requireProperTools || player.isCreative() || world.isClient()) {
            return true;
        }
        if (!state.isToolRequired()) {
            return true;
        }
        ItemStack tool = player.getMainHandStack();
        if (tool.isSuitableFor(state)) {
            return true;
        }

        if (cfg.handMiningHurts && cfg.handMiningDamage > 0.0F) {
            player.damage(world.getDamageSources().generic(), cfg.handMiningDamage);
        }
        player.sendMessage(Text.translatable("message.realisticblocks.need_tool", state.getBlock().getName()), true);
        return false;
    }
}
