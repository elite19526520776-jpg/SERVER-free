package com.realisticblocks.mixin;

import com.realisticblocks.physics.CollapseManager;
import net.minecraft.block.BlockState;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * 所有方块变化都会经过这里 —— 玩家挖掘、爆炸、活塞、着火、末影人搬砖，一律触发支撑复查。
 * Every block change funnels through here: mining, explosions, pistons, fire, endermen. All of
 * them re-trigger a structural check.
 */
@Mixin(World.class)
public abstract class WorldMixin {

    @Inject(
            method = "setBlockState(Lnet/minecraft/util/math/BlockPos;Lnet/minecraft/block/BlockState;II)Z",
            at = @At("RETURN")
    )
    private void realisticblocks$afterSetBlockState(BlockPos pos, BlockState state, int flags, int maxUpdateDepth,
                                                    CallbackInfoReturnable<Boolean> cir) {
        if (!cir.getReturnValueZ()) {
            return;
        }
        if ((Object) this instanceof ServerWorld serverWorld) {
            CollapseManager manager = CollapseManager.get(serverWorld);
            if (manager != null) {
                manager.onBlockChanged(pos);
            }
        }
    }
}
