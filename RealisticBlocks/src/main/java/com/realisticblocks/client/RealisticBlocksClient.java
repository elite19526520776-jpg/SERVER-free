package com.realisticblocks.client;

import com.realisticblocks.RealisticBlocks;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.resource.ResourceManagerHelper;
import net.fabricmc.fabric.api.resource.ResourcePackActivationType;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

/**
 * 把内置的写实材质包注册进资源包列表，玩家在「选项 → 资源包」里一键开启。
 * Registers the bundled photo-ish texture pack so it shows up under Options → Resource Packs.
 */
public class RealisticBlocksClient implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        FabricLoader.getInstance().getModContainer(RealisticBlocks.MOD_ID).ifPresent(container ->
                ResourceManagerHelper.registerBuiltinResourcePack(
                        Identifier.of(RealisticBlocks.MOD_ID, "realistic_textures"),
                        container,
                        Text.translatable("resourcePack.realisticblocks.realistic_textures"),
                        ResourcePackActivationType.NORMAL));
    }
}
