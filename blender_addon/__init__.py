# WebXR Camera Animation Importer for Blender
# This allows the addon to be installed as a package

from . import camera_animation_importer

def register():
    camera_animation_importer.register()

def unregister():
    camera_animation_importer.unregister()

if __name__ == "__main__":
    register()

