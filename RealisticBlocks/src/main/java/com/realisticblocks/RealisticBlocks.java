package com.realisticblocks;

import com.realisticblocks.command.RBCommand;
import com.realisticblocks.config.RBConfig;
import com.realisticblocks.feature.Encumbrance;
import com.realisticblocks.feature.HandMining;
import com.realisticblocks.physics.CollapseManager;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerWorldEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.minecraft.server.world.ServerWorld;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class RealisticBlocks implements ModInitializer {

    public static final String MOD_ID = "realisticblocks";
    public static final Logger LOGGER = LoggerFactory.getLogger("Realistic Blocks");

    @Override
    public void onInitialize() {
        RBConfig.load();

        ServerWorldEvents.LOAD.register((server, world) -> CollapseManager.create(world));
        ServerWorldEvents.UNLOAD.register((server, world) -> CollapseManager.remove(world));

        ServerTickEvents.END_WORLD_TICK.register(world -> {
            CollapseManager manager = CollapseManager.get(world);
            if (manager != null) {
                manager.tick();
            }
        });
        ServerTickEvents.END_SERVER_TICK.register(Encumbrance::tick);

        PlayerBlockBreakEvents.BEFORE.register(HandMining::beforeBreak);
        // Mixin 已经覆盖了 setBlockState，这里再挂一次是为了让玩家挖掘的响应尽量即时。
        // The mixin already covers setBlockState; this keeps player mining maximally responsive.
        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {
            if (world instanceof ServerWorld serverWorld) {
                CollapseManager manager = CollapseManager.get(serverWorld);
                if (manager != null) {
                    manager.onBlockChanged(pos);
                }
            }
        });

        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                RBCommand.register(dispatcher));

        LOGGER.info("Realistic Blocks ready - the world now has weight.");
    }
}
