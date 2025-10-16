bl_info = {
    "name": "WebXR Camera Animation Importer/Exporter",
    "author": "James C. Kane",
    "version": (1, 1, 0),
    "blender": (4, 2, 0),
    "location": "File > Import/Export > WebXR Camera Animation (.json)",
    "description": "Import and export WebXR camera animations for editing and playback",
    "category": "Import-Export",
}

import bpy
import json
import math
from pathlib import Path
from bpy.props import StringProperty, BoolProperty, FloatProperty, EnumProperty, IntProperty
from bpy_extras.io_utils import ImportHelper, ExportHelper
from mathutils import Vector, Quaternion, Euler


class WebXRCameraAnimationImporter(bpy.types.Operator, ImportHelper):
    """Import WebXR Camera Animation JSON"""
    bl_idname = "import_scene.webxr_camera_anim"
    bl_label = "Import WebXR Camera Animation"
    bl_options = {'REGISTER', 'UNDO'}

    # File browser filter
    filename_ext = ".json"
    filter_glob: StringProperty(
        default="*.json",
        options={'HIDDEN'},
    )

    # Import options
    create_camera: BoolProperty(
        name="Create New Camera",
        description="Create a new camera object for the animation",
        default=True,
    )
    
    use_existing_camera: BoolProperty(
        name="Use Active Camera",
        description="Apply animation to the active camera instead of creating new one",
        default=False,
    )
    
    scale_factor: FloatProperty(
        name="Scale Factor",
        description="Scale position data (WebXR uses meters, adjust for your scene scale)",
        default=1.0,
        min=0.001,
        max=1000.0,
    )
    
    coordinate_system: EnumProperty(
        name="Coordinate System",
        description="Convert from WebXR coordinate system",
        items=[
            ('BLENDER', 'Blender (Z-up)', 'Convert to Blender Z-up coordinate system'),
            ('WEBXR', 'WebXR (Y-up)', 'Keep WebXR Y-up coordinate system'),
        ],
        default='BLENDER',
    )
    
    apply_deltas: BoolProperty(
        name="Apply as Deltas",
        description="Apply position/rotation as deltas (relative to starting pose) vs absolute",
        default=False,
    )
    
    frame_rate: FloatProperty(
        name="Frame Rate",
        description="Target frame rate for keyframe conversion",
        default=30.0,
        min=1.0,
        max=120.0,
    )

    def execute(self, context):
        try:
            # Read JSON file
            with open(self.filepath, 'r') as f:
                data = json.load(f)
            
            # Validate data
            if 'frames' not in data or not isinstance(data['frames'], list):
                self.report({'ERROR'}, "Invalid JSON: missing 'frames' array")
                return {'CANCELLED'}
            
            frames = data.get('frames', [])
            if len(frames) == 0:
                self.report({'ERROR'}, "No frames found in animation data")
                return {'CANCELLED'}
            
            # Get or create camera
            camera = self._get_or_create_camera(context)
            if not camera:
                self.report({'ERROR'}, "Failed to get or create camera")
                return {'CANCELLED'}
            
            # Import animation
            self._import_animation(camera, frames, data)
            
            # Set active object and frame range
            context.view_layer.objects.active = camera
            camera.select_set(True)
            
            filename = Path(self.filepath).stem
            self.report({'INFO'}, f"Imported {len(frames)} frames from '{filename}'")
            
            return {'FINISHED'}
            
        except Exception as e:
            self.report({'ERROR'}, f"Import failed: {str(e)}")
            return {'CANCELLED'}

    def _get_or_create_camera(self, context):
        """Get existing camera or create new one"""
        if self.use_existing_camera and context.scene.camera:
            return context.scene.camera
        
        if self.create_camera or not context.scene.camera:
            # Create new camera
            camera_data = bpy.data.cameras.new(name="WebXR_Camera")
            camera_obj = bpy.data.objects.new("WebXR_Camera", camera_data)
            context.collection.objects.link(camera_obj)
            
            # Set as active camera
            context.scene.camera = camera_obj
            
            return camera_obj
        
        return None

    def _import_animation(self, camera, frames, metadata):
        """Import animation frames as keyframes"""
        scene = bpy.context.scene
        
        # Calculate frame timing
        duration = frames[-1]['t']
        total_frames = int(duration * self.frame_rate)
        
        # Set scene frame range
        scene.frame_start = 1
        scene.frame_end = max(total_frames, 1)
        scene.render.fps = int(self.frame_rate)
        
        # Store initial position/rotation if applying deltas
        initial_pos = Vector((0, 0, 0))
        initial_rot = Quaternion((1, 0, 0, 0))
        
        if self.apply_deltas:
            initial_pos = camera.location.copy()
            initial_rot = camera.rotation_quaternion.copy() if camera.rotation_mode == 'QUATERNION' else camera.rotation_euler.to_quaternion()
        
        # Set rotation mode to quaternion for smoother interpolation
        camera.rotation_mode = 'QUATERNION'
        
        # Clear existing animation
        if camera.animation_data:
            camera.animation_data_clear()
        
        # Create action
        action_name = f"WebXR_Anim_{Path(self.filepath).stem}"
        action = bpy.data.actions.new(name=action_name)
        camera.animation_data_create()
        camera.animation_data.action = action
        
        # Get first frame data for delta calculation
        first_frame = frames[0]
        q0 = Quaternion((first_frame['q'][3], first_frame['q'][0], first_frame['q'][1], first_frame['q'][2]))
        p0 = Vector((first_frame['p'][0], first_frame['p'][1], first_frame['p'][2])) if 'p' in first_frame else Vector((0, 0, 0))
        
        # Import each frame
        for frame_data in frames:
            time = frame_data['t']
            frame_number = int(time * self.frame_rate) + 1
            
            # Parse quaternion (XYZW in JSON -> WXYZ in Blender)
            q = Quaternion((
                frame_data['q'][3],  # W
                frame_data['q'][0],  # X
                frame_data['q'][1],  # Y
                frame_data['q'][2]   # Z
            ))
            
            # Parse position if available
            p = Vector((0, 0, 0))
            if 'p' in frame_data and frame_data['p']:
                p = Vector((
                    frame_data['p'][0],
                    frame_data['p'][1],
                    frame_data['p'][2]
                ))
            
            # Apply coordinate system conversion (WebXR Y-up to Blender Z-up)
            if self.coordinate_system == 'BLENDER':
                # Convert Y-up (WebXR) to Z-up (Blender)
                # Position: Y and Z swap, negate new Z
                p_converted = Vector((p.x, -p.z, p.y))
                
                # Rotation: Apply 90° rotation around X to convert coordinate systems
                # In WebXR Y-up: forward=-Z, up=+Y, right=+X
                # In Blender Z-up: forward=-Y, up=+Z, right=+X
                # We need to rotate the quaternion to match this transform
                basis_rotation = Quaternion((0.7071068, 0.7071068, 0, 0))  # 90° around X axis
                q_converted = basis_rotation @ q
            else:
                q_converted = q
                p_converted = p
            
            # Apply scale
            p_converted *= self.scale_factor
            
            # Apply deltas if requested (relative to initial pose)
            if self.apply_deltas:
                # Calculate delta rotation: initial^-1 * q0^-1 * q
                q_delta = q0.inverted() @ q_converted
                q_final = initial_rot @ q_delta
                
                # Calculate delta position in initial orientation space
                p_delta = p_converted - p0
                if self.coordinate_system == 'BLENDER':
                    p_delta_rotated = initial_rot @ p_delta
                else:
                    p_delta_rotated = p_delta
                p_final = initial_pos + p_delta_rotated
            else:
                q_final = q_converted
                p_final = p_converted
            
            # Set frame
            scene.frame_set(frame_number)
            
            # Apply transform
            camera.location = p_final
            camera.rotation_quaternion = q_final
            
            # Insert keyframes
            camera.keyframe_insert(data_path="location", frame=frame_number)
            camera.keyframe_insert(data_path="rotation_quaternion", frame=frame_number)
        
        # Set interpolation to bezier for smooth motion
        if camera.animation_data and camera.animation_data.action:
            for fcurve in camera.animation_data.action.fcurves:
                for keyframe in fcurve.keyframe_points:
                    keyframe.interpolation = 'BEZIER'
                    keyframe.handle_left_type = 'AUTO_CLAMPED'
                    keyframe.handle_right_type = 'AUTO_CLAMPED'
        
        # Reset to first frame
        scene.frame_set(1)
        
        # Store metadata as custom properties
        camera["webxr_animation_source"] = Path(self.filepath).name
        camera["webxr_animation_duration"] = duration
        camera["webxr_animation_frames"] = len(frames)
        if 'referenceSpaceType' in metadata:
            camera["webxr_reference_space"] = metadata['referenceSpaceType']


class WebXRCameraAnimationExporter(bpy.types.Operator, ExportHelper):
    """Export WebXR Camera Animation JSON"""
    bl_idname = "export_scene.webxr_camera_anim"
    bl_label = "Export WebXR Camera Animation"
    bl_options = {'REGISTER', 'UNDO'}

    # File browser filter
    filename_ext = ".json"
    filter_glob: StringProperty(
        default="*.json",
        options={'HIDDEN'},
    )

    # Export options
    export_active_camera: BoolProperty(
        name="Export Active Camera",
        description="Export the active scene camera (if false, exports selected camera)",
        default=True,
    )
    
    scale_factor: FloatProperty(
        name="Scale Factor",
        description="Scale position data (inverse of import scale, e.g., 1.0 if imported at 1.0)",
        default=1.0,
        min=0.001,
        max=1000.0,
    )
    
    coordinate_system: EnumProperty(
        name="Coordinate System",
        description="Convert to WebXR coordinate system",
        items=[
            ('WEBXR', 'WebXR (Y-up)', 'Convert to WebXR Y-up coordinate system'),
            ('BLENDER', 'Blender (Z-up)', 'Keep Blender Z-up coordinate system (no conversion)'),
        ],
        default='WEBXR',
    )
    
    sample_mode: EnumProperty(
        name="Sample Mode",
        description="How to sample the animation",
        items=[
            ('KEYFRAMES', 'Keyframes Only', 'Export only existing keyframes'),
            ('ALL_FRAMES', 'All Frames', 'Sample every frame in frame range'),
            ('CUSTOM_RATE', 'Custom Rate', 'Sample at custom frame rate'),
        ],
        default='ALL_FRAMES',
    )
    
    custom_sample_rate: IntProperty(
        name="Custom Sample Rate",
        description="Sample every Nth frame (only for Custom Rate mode)",
        default=1,
        min=1,
        max=100,
    )
    
    export_position: BoolProperty(
        name="Export Position",
        description="Include position data in export",
        default=True,
    )
    
    reference_space_type: EnumProperty(
        name="Reference Space Type",
        description="WebXR reference space type metadata",
        items=[
            ('local-floor', 'local-floor', 'Local floor reference space'),
            ('local', 'local', 'Local reference space'),
            ('bounded-floor', 'bounded-floor', 'Bounded floor reference space'),
            ('unbounded', 'unbounded', 'Unbounded reference space'),
            ('viewer', 'viewer', 'Viewer reference space'),
        ],
        default='local-floor',
    )

    def execute(self, context):
        try:
            # Get camera to export
            camera = self._get_camera(context)
            if not camera:
                self.report({'ERROR'}, "No camera found to export")
                return {'CANCELLED'}
            
            # Validate animation
            if not camera.animation_data or not camera.animation_data.action:
                self.report({'ERROR'}, "Camera has no animation data")
                return {'CANCELLED'}
            
            # Export animation
            animation_data = self._export_animation(context, camera)
            
            # Write JSON file
            with open(self.filepath, 'w') as f:
                json.dump(animation_data, f, indent=2)
            
            filename = Path(self.filepath).name
            frame_count = len(animation_data['frames'])
            self.report({'INFO'}, f"Exported {frame_count} frames to '{filename}'")
            
            return {'FINISHED'}
            
        except Exception as e:
            self.report({'ERROR'}, f"Export failed: {str(e)}")
            return {'CANCELLED'}

    def _get_camera(self, context):
        """Get camera to export"""
        if self.export_active_camera:
            return context.scene.camera
        else:
            # Get selected camera
            selected = [obj for obj in context.selected_objects if obj.type == 'CAMERA']
            if selected:
                return selected[0]
        return None

    def _export_animation(self, context, camera):
        """Export animation frames as JSON"""
        scene = context.scene
        
        # Determine frames to sample
        frames_to_sample = self._get_frames_to_sample(camera, scene)
        
        # Store original frame and rotation mode
        original_frame = scene.frame_current
        original_rotation_mode = camera.rotation_mode
        
        # Temporarily set to quaternion for export
        needs_quaternion_conversion = camera.rotation_mode != 'QUATERNION'
        if needs_quaternion_conversion:
            camera.rotation_mode = 'QUATERNION'
        
        # Export frames
        exported_frames = []
        fps = scene.render.fps
        
        for frame_num in frames_to_sample:
            scene.frame_set(frame_num)
            
            # Calculate timestamp
            time = (frame_num - scene.frame_start) / fps
            
            # Get rotation (quaternion)
            q = camera.rotation_quaternion.copy()
            
            # Get position
            p = camera.location.copy()
            
            # Apply coordinate system conversion (Blender Z-up to WebXR Y-up)
            if self.coordinate_system == 'WEBXR':
                # Convert Z-up (Blender) to Y-up (WebXR)
                # Position: swap Y and Z, negate new Z
                p_converted = Vector((p.x, p.z, -p.y))
                
                # Rotation: Inverse of import rotation
                # Apply -90° rotation around X to convert back
                basis_rotation_inv = Quaternion((0.7071068, -0.7071068, 0, 0))  # -90° around X
                q_converted = basis_rotation_inv @ q
            else:
                q_converted = q
                p_converted = p
            
            # Apply scale (inverse of import)
            p_converted /= self.scale_factor
            
            # Build frame data
            frame_data = {
                "t": round(time, 4),
                "q": [
                    round(q_converted.x, 6),
                    round(q_converted.y, 6),
                    round(q_converted.z, 6),
                    round(q_converted.w, 6)
                ]
            }
            
            # Add position if requested
            if self.export_position:
                frame_data["p"] = [
                    round(p_converted.x, 6),
                    round(p_converted.y, 6),
                    round(p_converted.z, 6)
                ]
            
            exported_frames.append(frame_data)
        
        # Restore original state
        scene.frame_set(original_frame)
        if needs_quaternion_conversion:
            camera.rotation_mode = original_rotation_mode
        
        # Build output JSON
        output = {
            "frames": exported_frames,
            "referenceSpaceType": self.reference_space_type,
            "metadata": {
                "exportedFrom": "Blender",
                "blenderVersion": ".".join(map(str, bpy.app.version)),
                "cameraName": camera.name,
                "fps": fps,
                "frameRange": [scene.frame_start, scene.frame_end],
            }
        }
        
        # Include original source if available
        if "webxr_animation_source" in camera:
            output["metadata"]["originalSource"] = camera["webxr_animation_source"]
        
        return output

    def _get_frames_to_sample(self, camera, scene):
        """Determine which frames to sample based on sample mode"""
        if self.sample_mode == 'KEYFRAMES':
            # Get all keyframe positions
            keyframe_numbers = set()
            if camera.animation_data and camera.animation_data.action:
                for fcurve in camera.animation_data.action.fcurves:
                    for keyframe in fcurve.keyframe_points:
                        keyframe_numbers.add(int(keyframe.co.x))
            return sorted(keyframe_numbers)
        
        elif self.sample_mode == 'CUSTOM_RATE':
            # Sample every Nth frame
            return list(range(scene.frame_start, scene.frame_end + 1, self.custom_sample_rate))
        
        else:  # ALL_FRAMES
            # Sample every frame
            return list(range(scene.frame_start, scene.frame_end + 1))


class IMPORT_MT_webxr_camera_anim(bpy.types.Menu):
    bl_label = "WebXR Camera Animation"
    
    def draw(self, context):
        self.layout.operator(WebXRCameraAnimationImporter.bl_idname, text="WebXR Camera Animation (.json)")


def menu_func_import(self, context):
    self.layout.operator(WebXRCameraAnimationImporter.bl_idname, text="WebXR Camera Animation (.json)")


def menu_func_export(self, context):
    self.layout.operator(WebXRCameraAnimationExporter.bl_idname, text="WebXR Camera Animation (.json)")


# Registration
classes = (
    WebXRCameraAnimationImporter,
    WebXRCameraAnimationExporter,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(menu_func_import)
    bpy.types.TOPBAR_MT_file_export.append(menu_func_export)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    bpy.types.TOPBAR_MT_file_import.remove(menu_func_import)
    bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)


if __name__ == "__main__":
    register()

