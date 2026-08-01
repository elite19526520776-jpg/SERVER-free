package com.realisticblocks.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.realisticblocks.RealisticBlocks;
import com.realisticblocks.config.RBConfig;
import com.realisticblocks.physics.CollapseManager;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/** /realisticblocks —— 不重启就能改玩法。Tune the mod without restarting. */
public final class RBCommand {

    private RBCommand() {
    }

    public static void register(CommandDispatcher<ServerCommandSource> dispatcher) {
        LiteralArgumentBuilder<ServerCommandSource> root = CommandManager
                .literal(RealisticBlocks.MOD_ID)
                .requires(source -> source.hasPermissionLevel(2));

        root.then(CommandManager.literal("status").executes(RBCommand::status));
        root.then(CommandManager.literal("reload").executes(RBCommand::reload));

        root.then(CommandManager.literal("gravity")
                .then(CommandManager.literal("on").executes(ctx -> setGravity(ctx.getSource(), true)))
                .then(CommandManager.literal("off").executes(ctx -> setGravity(ctx.getSource(), false)))
                .then(CommandManager.literal("distance")
                        .then(CommandManager.argument("blocks", IntegerArgumentType.integer(0, 32))
                                .executes(ctx -> {
                                    RBConfig.get().maxSupportDistance = IntegerArgumentType.getInteger(ctx, "blocks");
                                    RBConfig.save();
                                    return feedback(ctx.getSource(), "maxSupportDistance = "
                                            + RBConfig.get().maxSupportDistance);
                                }))));

        root.then(CommandManager.literal("tools")
                .then(CommandManager.literal("on").executes(ctx -> setTools(ctx.getSource(), true)))
                .then(CommandManager.literal("off").executes(ctx -> setTools(ctx.getSource(), false))));

        root.then(CommandManager.literal("weight")
                .then(CommandManager.literal("on").executes(ctx -> setWeight(ctx.getSource(), true)))
                .then(CommandManager.literal("off").executes(ctx -> setWeight(ctx.getSource(), false))));

        dispatcher.register(root);
    }

    private static int status(com.mojang.brigadier.context.CommandContext<ServerCommandSource> ctx) {
        RBConfig cfg = RBConfig.get();
        ServerCommandSource source = ctx.getSource();
        ServerWorld world = source.getWorld();
        CollapseManager manager = CollapseManager.get(world);
        int pending = manager == null ? 0 : manager.pendingCount();

        source.sendFeedback(() -> Text.literal("Realistic Blocks").formatted(Formatting.GOLD), false);
        source.sendFeedback(() -> Text.literal("  gravity: " + cfg.enableGravity
                + "  (support distance " + cfg.maxSupportDistance
                + ", arch thickness " + cfg.selfSupportThickness + ")"), false);
        source.sendFeedback(() -> Text.literal("  tool requirement: " + cfg.requireProperTools), false);
        source.sendFeedback(() -> Text.literal("  encumbrance: " + cfg.enableEncumbrance
                + "  (threshold " + (int) cfg.weightThreshold + ")"), false);
        source.sendFeedback(() -> Text.literal("  pending checks in this dimension: " + pending), false);
        return 1;
    }

    private static int reload(com.mojang.brigadier.context.CommandContext<ServerCommandSource> ctx) {
        RBConfig.load();
        return feedback(ctx.getSource(), "config reloaded");
    }

    private static int setGravity(ServerCommandSource source, boolean value) {
        RBConfig.get().enableGravity = value;
        RBConfig.save();
        return feedback(source, "gravity = " + value);
    }

    private static int setTools(ServerCommandSource source, boolean value) {
        RBConfig.get().requireProperTools = value;
        RBConfig.save();
        return feedback(source, "tool requirement = " + value);
    }

    private static int setWeight(ServerCommandSource source, boolean value) {
        RBConfig.get().enableEncumbrance = value;
        RBConfig.save();
        return feedback(source, "encumbrance = " + value);
    }

    private static int feedback(ServerCommandSource source, String message) {
        source.sendFeedback(() -> Text.literal("[Realistic Blocks] " + message).formatted(Formatting.GRAY), true);
        return 1;
    }
}
