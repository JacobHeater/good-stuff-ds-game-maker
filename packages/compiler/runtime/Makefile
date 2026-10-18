#---------------------------------------------------------------------------------
# Build file for the Good Stuff DS runtime. Adapted from libnds's own example
# Makefile (devkitPro), so it builds the standard way: `make` produces gsgame.nds.
#
# Run it with DEVKITPRO/DEVKITARM set and the compilers on PATH; the compiler's build
# driver does that. tools/ds-toolchain/README.md has the details.
#---------------------------------------------------------------------------------
.SUFFIXES:

ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM in your environment. export DEVKITARM=<path to>devkitARM")
endif

# A directory of files ndstool packs straight into the ROM's own NitroFS region (STORY.tile-map-3d.md), read back
# at runtime with plain fopen/fread ("nitro:/...") once nitroFSInit() has run -- not compiled in like source files,
# so nothing here has to be resident in RAM until something actually opens it. Always present (even empty, for a
# project with no TileMap3D) so this Makefile builds the same way either way. ds_rules reads NITRO_FILES itself,
# in a plain top-level `ifneq`, not inside a recipe -- it has to be set before `include` below runs, in BOTH the
# top-level make and the recursive one in $(BUILD) (that recursive invocation re-parses this whole file from
# scratch with a different CURDIR, so a CURDIR-relative path here would resolve to two different places). Deriving
# it from this Makefile's own path instead of CURDIR keeps it the same in both: the recursive invocation already
# passes this same file by its own absolute path (`-f $(CURDIR)/Makefile` below, captured from the top-level pass),
# so $(MAKEFILE_LIST) resolves to that same absolute path there too.
NITRO_FILES	:=	$(dir $(lastword $(MAKEFILE_LIST)))nitrofs

include $(DEVKITARM)/ds_rules

TARGET		:=	gsgame
BUILD		:=	build
SOURCES		:=	source
INCLUDES	:=	include

ARCH	:=	-march=armv5te -mtune=arm946e-s -mthumb

# -fwrapv: script integers wrap on overflow (requirements/scripting/TASK.script-language-front-end.md), which C only defines with this.
# -fno-strict-aliasing: matrices are our GsMatrix in some places and libnds's m4x4 in others, and are passed between them by cast; without this,
# -O2 may reorder or drop the stores that fill one before the other is read (a scripted camera's view intermittently drew nothing).
CFLAGS	:=	-g -Wall -O2 -fwrapv -fno-strict-aliasing -ffunction-sections -fdata-sections $(ARCH)
CFLAGS	+=	$(INCLUDE) -DARM9

ASFLAGS	:=	-g $(ARCH)
LDFLAGS	=	-specs=ds_arm9.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)

LIBS	:= -lfat -lnds9
LIBDIRS	:=	$(LIBNDS)

ifneq ($(BUILD),$(notdir $(CURDIR)))

export OUTPUT	:=	$(CURDIR)/$(TARGET)
export VPATH	:=	$(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR	:=	$(CURDIR)/$(BUILD)

CFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))

export LD	:=	$(CC)
export OFILES	:=	$(CFILES:.c=.o)

export INCLUDE	:=	$(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) \
					$(foreach dir,$(LIBDIRS),-I$(dir)/include) \
					-I$(CURDIR)/$(BUILD)

export LIBPATHS	:=	$(foreach dir,$(LIBDIRS),-L$(dir)/lib)

.PHONY: $(BUILD) clean

$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).elf $(TARGET).nds $(TARGET).ds.gba

else

DEPENDS	:=	$(OFILES:.o=.d)

$(OUTPUT).nds	: 	$(OUTPUT).elf
$(OUTPUT).elf	:	$(OFILES)

-include $(DEPENDS)

endif
